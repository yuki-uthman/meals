// Composition root. It builds the adapters, follows the Supabase client's own
// persisted session, and renders the screen the person is on: sign-in when there
// is no session, and otherwise Today, New meal, Edit meal or Add food inside the
// one frame.
//
// The draft being filled in lives here rather than in a screen, for the same
// reason the date being read does: a form is a pure function of a draft, so the
// draft has to be held by something that outlives a redraw. Typing updates it
// without re-rendering, which is what lets a refusal redraw the form with every
// value still in place.

import { createSupabaseClient } from './adapters/supabase/client';
import { supabaseIdentity } from './adapters/supabase/identity';
import { supabaseLogStore } from './adapters/supabase/log-store';
import {
  localToday,
  shiftDate,
  type AmountUnit,
  type ExerciseContext,
  type FoodType,
  type IsoDate,
  type Meal,
  type MealSlot,
} from './domain/entry';
import {
  historyDates,
  historyRows,
  HISTORY_RECORD_START,
  type HistoryView,
  type HistoryWindow,
} from './domain/history';
import { instancesOf, type InstanceRow, type MealInstance } from './domain/meal-identity';
import {
  emptyFoodDraft,
  foodDraftRefusal,
  mealDraftFrom,
  mealDraftRefusal,
  mealRecording,
  newMealDraft,
  repeatMealDraft,
  withFood,
  withoutFood,
  type FoodDraft,
  type MealDraft,
} from './domain/meal-draft';
import {
  newNightDraft,
  nightDraftFrom,
  nightDraftRefusal,
  nightRecording,
  nightRows,
  NIGHT_WINDOW,
  type NightDraft,
} from './domain/night';
import {
  lastReadingChip,
  readingChips,
  RECENT_MEALS_WINDOW,
  type ReadingChip,
  type RecentMeal,
} from './domain/recent-readings';
import type { Account, Credentials } from './ports/identity';
import { dayLogSection, type DayLogState } from './ui/day-log';
import { FOOD_FORM_TITLE, foodForm } from './ui/food-form';
import { mealDetailScreen, mealMissingScreen } from './ui/meal-detail';
import { mealForm, mealFormTitle, type MealPadChips, type MealPadTarget } from './ui/meal-form';
import { nightForm, NIGHT_FORM_TITLE, type NightHistory } from './ui/night-form';
import { historyScreen, type HistoryState } from './ui/history';
import { lookupScreen, type LookupState, type LookupTab } from './ui/lookup';
import {
  DEFAULT_CHANGE_WINDOW,
  DEFAULT_START_WINDOW,
  type ChangeWindow,
  type StartWindow,
} from './domain/nearest-lookup';
import { shell, type ShellHandlers, type ShellTab } from './ui/shell';
import { emptySignInState, signInScreen, type SignInState } from './ui/sign-in';

const mount = (): HTMLElement => {
  const root = document.getElementById('app');
  if (root === null) throw new Error('Missing #app mount point');
  return root;
};

const start = (): void => {
  const root = mount();
  const client = createSupabaseClient();
  const identity = supabaseIdentity(client);
  const logStore = supabaseLogStore(client);
  /**
   * The date being read lives here, not in a screen, because moving it is a
   * fresh read through the log-store port rather than a redraw of rows already
   * in hand. Nothing caches another day's entries.
   */
  let date: IsoDate = localToday();

  let account: Account | null = null;
  let signInState: SignInState = emptySignInState;
  let dayLogState: DayLogState = { kind: 'loading' };
  /** Guards against a slow read from an earlier account landing on a later one. */
  let readToken = 0;

  /** Which screen the signed-in person is on. Today unless a meal is being filled in. */
  let screen: 'day' | 'meal' | 'food' | 'night' | 'detail' | 'history' | 'lookup' = 'day';

  /**
   * Looking back by food. The whole history is read once when the section is
   * opened and every keystroke is matching over what is already in hand, so
   * typing is arithmetic rather than a read per character. What is typed lives
   * here, not in the screen, for the same reason a draft does: the screen is a
   * pure function of it and outlives no redraw of its own.
   */
  let lookupMeals: readonly MealInstance[] | null = null;
  let lookupQuery = '';
  let lookupMessage: string | null = null;
  /**
   * Which way of looking back is open, and what By change is asking: the signed
   * target as typed and the window it is asked within. They live here for the same
   * reason the query does -- the screen is a pure function of them -- and the window
   * starts at plus or minus 5, which is the slack the design defaults to.
   */
  let lookupTab: LookupTab = 'food';
  let lookupTarget = '';
  let lookupWindow: ChangeWindow = DEFAULT_CHANGE_WINDOW;
  /**
   * What By start is asking: the unsigned starting reading as typed and its own
   * window, which starts at plus or minus 10. They are held apart from By change's
   * pair because they are different questions over different quantities -- a
   * tolerance on a reading is coarser than one on a change -- so neither tab may
   * ever answer with the other's target or the other's slack.
   */
  let lookupStartTarget = '';
  let lookupStartWindow: StartWindow = DEFAULT_START_WINDOW;
  /** Guards against a slow read from an earlier account landing on a later one. */
  let lookupToken = 0;

  /**
   * The History grid. The whole record is read once -- for one or two people's log
   * it is already in hand -- and the grid runs from today back to its earliest
   * entry, so switching the view is a redraw of material already here rather than
   * another read, and going further back is scrolling rather than a second page.
   */
  let historyWindow: HistoryWindow | null = null;
  /** The date the grid's rows are counted back from, fixed when the read landed. */
  let historyToday: IsoDate = localToday();
  let historyMessage: string | null = null;
  let historyView: HistoryView = 'before';
  /** Guards against a slow grid read from an earlier account landing on a later one. */
  let historyToken = 0;
  /**
   * How far the grid was scrolled when it was last left. Coming back to the top of
   * ninety rows after cancelling is barely better than being dumped on Today: the
   * point of going back is to carry on where you were, and that is worst exactly
   * where it matters most -- part-way down somebody's paper log being copied in.
   */
  let historyScroll = 0;
  /**
   * The section a form was opened from, when it was not the day log. A form that
   * came from History keeps History's navigation, which is how the grid is got
   * back to; a form opened on Today has none, because the way out of one is
   * Cancel or Save.
   */
  let formSection: ShellTab | undefined = undefined;
  /**
   * The meal being looked at, and every instance of its foods. Both are held
   * here rather than in the screen, for the same reason a draft is: the screen
   * is a pure function of them and outlives no redraw of its own.
   */
  let detailMeal: Meal | null = null;
  let detailInstances: readonly InstanceRow[] = [];
  let detailMessage: string | null = null;
  /**
   * Why the detail could not be shown at all, when the meal itself did not come
   * back. Distinct from detailMessage, which is a history that failed beside a
   * meal that is on screen.
   */
  let detailRefusal: string | null = null;
  let mealDraft: MealDraft | null = null;
  let foodDraft: FoodDraft | null = null;
  let nightDraft: NightDraft | null = null;
  /**
   * The five nights the night screen lists. Read before the screen is shown, not
   * after, so the list is never a row of blanks that reads as five empty nights.
   */
  let nightHistory: NightHistory | null = null;
  /**
   * The recent meals the pad's chips are read off. They are fetched before a
   * form is shown, for the same reason the five nights are: a chip that arrived
   * after the person had already started keying would be a moving target.
   */
  let recentMeals: readonly RecentMeal[] = [];
  /**
   * Every meal this account has recorded, which is what the expected-after estimate
   * is read off. It is fetched before a meal form is shown, for the same reason the
   * chips are: an estimate that appeared after the person had begun keying would be
   * a moving target. Which meal the estimate is built from is the domain's rule.
   */
  let mealHistory: readonly MealInstance[] = [];
  /** Why the history could not be read, so the panel never claims nothing happened. */
  let mealHistoryMessage: string | null = null;
  /** Which field the in-app pad is open on. Closed unless a glucose field asked. */
  let padTarget: MealPadTarget = null;
  let nightPadOpen = false;
  /** A refusal or retry from the screen the person is on, shown in place. */
  let formMessage: string | null = null;
  let saving = false;

  const dayHandlers: ShellHandlers = {
    onSignOut: () => void signOut(),
    onPreviousDay: () => moveDay(-1),
    onNextDay: () => moveDay(1),
    onNavigate: (tab) => goTo(tab),
  };

  const todayScreen = (): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), tab: 'today' },
      dayHandlers,
      dayLogSection(dayLogState, {
        onRetry: () => void loadDayLog(),
        onLogSlot: (slot) => void logSlot(slot),
        onEditMeal: (id) => void editMeal(id),
        onOpenNight: () => void openNight(),
        onOpenMeal: (id) => void openMealDetail(id),
      }),
    );

  const missingScreen = (message: string): HTMLElement =>
    shell(
      { date, isToday: date === localToday() },
      dayHandlers,
      mealMissingScreen(message, { onBack: () => backToDay() }),
    );

  const detailScreen = (meal: Meal): HTMLElement =>
    shell(
      { date, isToday: date === localToday() },
      dayHandlers,
      mealDetailScreen(
        { meal, instances: detailInstances, message: detailMessage },
        { onBack: () => backToDay(), onLogAgain: () => void logAgain(meal) },
      ),
    );

  /** The readings a chip may repeat, never a number this app worked out. */
  const presentChips = (chips: readonly (ReadingChip | null)[]): readonly ReadingChip[] =>
    chips.filter((chip): chip is ReadingChip => chip !== null);

  /**
   * The before field is offered both chips; the after field only the last
   * reading, because there is no such thing as 'the after reading you usually
   * start dinner on'. The meal being edited is excluded from its own history.
   */
  const mealChips = (draft: MealDraft): MealPadChips => ({
    before: readingChips(recentMeals, draft.slot, draft.mealId),
    after: presentChips([lastReadingChip(recentMeals, draft.mealId)]),
  });

  const mealScreen = (draft: MealDraft): HTMLElement =>
    shell(
      {
        date,
        isToday: date === localToday(),
        tab: formSection,
        form: { title: mealFormTitle(draft), busy: saving },
      },
      { ...dayHandlers, onCancel: () => leaveForm(), onSave: () => void saveMeal() },
      mealForm(
        {
          draft,
          padTarget,
          chips: mealChips(draft),
          history: mealHistory,
          historyMessage: mealHistoryMessage,
          message: formMessage,
        },
        {
          // Opening and closing the pad is a change to the field's own corner of
          // the screen, so it is recorded here and deliberately NOT re-rendered:
          // redrawing would replace the very input the pad writes into.
          onOpenPad: (target) => {
            padTarget = target;
          },
          onClosePad: () => {
            padTarget = null;
          },
          onSlot: (slot) => patchMeal({ slot }),
          onTime: (time) => patchMeal({ time }),
          onGlucoseBefore: (glucoseBefore) => patchMeal({ glucoseBefore }),
          onGlucoseAfter: (glucoseAfter) => patchMeal({ glucoseAfter }),
          onInsulinUnits: (insulinUnits) => patchMeal({ insulinUnits }),
          onExerciseContext: (exerciseContext: ExerciseContext) => patchMeal({ exerciseContext }),
          onNote: (note) => patchMeal({ note }),
          onAddFood: () => openFoodForm(),
          onRemoveFood: (index) => removeFood(index),
        },
      ),
    );

  const foodScreen = (draft: FoodDraft): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), form: { title: FOOD_FORM_TITLE, busy: false } },
      { ...dayHandlers, onCancel: () => backToMeal(), onSave: () => keepFood() },
      foodForm(
        { draft, message: formMessage },
        {
          onName: (name) => patchFood({ name }),
          onFoodType: (foodType: FoodType) => patchFood({ foodType }),
          onAmount: (amount) => patchFood({ amount }),
          onUnit: (unit: AmountUnit) => patchFood({ unit }),
        },
      ),
    );

  const nightScreen = (draft: NightDraft, history: NightHistory): HTMLElement =>
    shell(
      {
        date,
        isToday: date === localToday(),
        tab: formSection,
        form: { title: NIGHT_FORM_TITLE, busy: saving },
      },
      { ...dayHandlers, onCancel: () => leaveForm(), onSave: () => void saveNight() },
      nightForm(
        {
          draft,
          history,
          padOpen: nightPadOpen,
          chips: presentChips([lastReadingChip(recentMeals)]),
          message: formMessage,
        },
        {
          // Recorded, not re-rendered, for the same reason as the meal screen's.
          onOpenPad: () => {
            nightPadOpen = true;
          },
          onClosePad: () => {
            nightPadOpen = false;
          },
          onUnits: (units) => patchNight({ units }),
          onTakenAt: (takenAt) => patchNight({ takenAt }),
          onBedtimeGlucose: (bedtimeGlucose) => patchNight({ bedtimeGlucose }),
        },
      ),
    );

  /**
   * The grid as the screen reads it. Which reading lands in which column and
   * which band it falls in is the domain's rule; this only says which of the
   * three states the section is in.
   */
  const historySectionState = (): HistoryState => {
    if (historyMessage !== null) return { kind: 'failed', message: historyMessage };
    if (historyWindow === null) return { kind: 'loading' };
    // How far back the grid runs is read off the record itself: today back to the
    // earliest entry, with the floor so a short log still reads as a grid.
    const dates = historyDates(historyToday, historyWindow);
    return { kind: 'loaded', rows: historyRows(historyWindow, dates, historyView) };
  };

  const historySection = (): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), heading: 'History', tab: 'history' },
      dayHandlers,
      historyScreen(
        { view: historyView, state: historySectionState() },
        {
          // The view colours what is already in hand, so choosing one is a redraw
          // and never another read.
          onView: (next) => {
            // Choosing a view recolours the rows in front of the person, so it
            // keeps them in front of the person rather than jumping to the top.
            rememberHistoryScroll();
            historyView = next;
            render();
          },
          onOpen: (target) => {
            // Where the person was in the grid, kept before the cell takes them
            // out of it, so leaving the form they opened lands them back here.
            rememberHistoryScroll();
            if (target.kind === 'meal') {
              // A slot cell opens that meal's EDIT form, which is where the after
              // reading taken two hours later gets added.
              void editMealFromHistory(target.id, target.eatenOn);
              return;
            }
            if (target.kind === 'new-meal') {
              // An empty slot cell opens New meal with that DATE and that SLOT
              // already chosen, so saving records against the date the cell named
              // rather than against today: backfilling is what History is for.
              void newMealFromHistory(target.date, target.slot);
              return;
            }
            void openNightFor(target.nightOn);
          },
          onRetry: () => void loadHistory(),
        },
      ),
    );

  /**
   * The lookup as the screen reads it. Which meals match what was typed, and the
   * three figures over them, are the domain's rules; this only says which of the
   * three states the section is in.
   */
  const lookupSectionState = (): LookupState =>
    lookupMessage !== null
      ? { kind: 'failed', message: lookupMessage }
      : { kind: 'loaded', meals: lookupMeals ?? [] };

  const lookupSection = (): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), heading: 'Lookup', tab: 'lookup' },
      dayHandlers,
      lookupScreen(
        {
          tab: lookupTab,
          query: lookupQuery,
          target: lookupTarget,
          window: lookupWindow,
          startTarget: lookupStartTarget,
          startWindow: lookupStartWindow,
          state: lookupSectionState(),
        },
        {
          // Recorded and deliberately NOT re-rendered here: the screen redraws its
          // own results below the field, because rebuilding the whole screen on a
          // keystroke would replace the field being typed into. Recording it is
          // what lets a redraw for any other reason keep what was typed.
          onQuery: (query) => {
            lookupQuery = query;
          },
          // The target is recorded and not re-rendered, for exactly the reason the
          // query is: the panel below the field redraws itself.
          onTarget: (target) => {
            lookupTarget = target;
          },
          // A tab and a window are structural, so both redraw -- over meals already
          // in hand, never another read.
          onTab: (tab) => {
            lookupTab = tab;
            render();
          },
          onWindow: (bound) => {
            lookupWindow = bound;
            render();
          },
          // The starting reading is recorded and not re-rendered, for exactly the
          // reason the change target is; its window is structural and redraws.
          onStartTarget: (target) => {
            lookupStartTarget = target;
          },
          onStartWindow: (bound) => {
            lookupStartWindow = bound;
            render();
          },
          onOpen: (id) => void openMealDetail(id),
          onRetry: () => void retryLookup(),
        },
      ),
    );

  const signedInScreen = (): HTMLElement => {
    if (screen === 'night' && nightDraft !== null && nightHistory !== null) {
      return nightScreen(nightDraft, nightHistory);
    }
    if (screen === 'history') return historySection();
    if (screen === 'lookup') return lookupSection();
    if (screen === 'detail' && detailRefusal !== null) return missingScreen(detailRefusal);
    if (screen === 'detail' && detailMeal !== null) return detailScreen(detailMeal);
    if (screen === 'food' && foodDraft !== null) return foodScreen(foodDraft);
    if (screen === 'meal' && mealDraft !== null) return mealScreen(mealDraft);
    return todayScreen();
  };

  /** Where the page is scrolled. The document is what scrolls; nothing nests one. */
  const scroller = (): Element | null => document.scrollingElement;

  /** Remembered as the grid is left, so returning can put it back where it was. */
  const rememberHistoryScroll = (): void => {
    const node = scroller();
    if (node !== null) historyScroll = node.scrollTop;
  };

  /**
   * Put back after the grid is drawn. Twice: once now, and once on the next frame,
   * because the rows' height is what the offset is clamped against and the browser
   * has not necessarily laid ninety of them out yet.
   */
  const restoreHistoryScroll = (): void => {
    const node = scroller();
    if (node === null) return;
    node.scrollTop = historyScroll;
    requestAnimationFrame(() => {
      const again = scroller();
      // Only while the grid is still the screen: a frame that lands after the
      // person has moved on must not scroll whatever replaced it.
      if (again !== null && screen === 'history' && account !== null) {
        again.scrollTop = historyScroll;
      }
    });
  };

  const render = (): void => {
    root.replaceChildren(
      account === null
        ? signInScreen(signInState, { onSubmit: (credentials) => void submit(credentials) })
        : signedInScreen(),
    );
    if (account !== null && screen === 'history') restoreHistoryScroll();
  };

  // ------------------------------------------------------------ filling in

  /**
   * Typing updates the draft and deliberately does not re-render: rebuilding the
   * inputs on every keystroke would take the caret with it. The screen is redrawn
   * when something structural changes -- a food added, a refusal to show.
   */
  const patchMeal = (change: Partial<MealDraft>): void => {
    if (mealDraft !== null) mealDraft = { ...mealDraft, ...change };
  };

  const patchFood = (change: Partial<FoodDraft>): void => {
    if (foodDraft !== null) foodDraft = { ...foodDraft, ...change };
  };

  const patchNight = (change: Partial<NightDraft>): void => {
    if (nightDraft !== null) nightDraft = { ...nightDraft, ...change };
  };

  /**
   * The night screen, reached from Today's night insulin card and recording
   * against the date Today is reading. The night already on the date is opened as
   * the draft, id and all, so saving updates that night rather than adding a
   * second one. The five nights are read before the screen is shown.
   */
  /**
   * The grid's material: every meal and night of the longest period, read
   * through the port with no account identifier anywhere, so row-level security
   * is the only thing that decides whose readings can appear in it.
   */
  const loadHistory = async (): Promise<void> => {
    const token = ++historyToken;
    historyMessage = null;
    historyToday = localToday();
    // The window in hand is deliberately kept while the read is in flight: it
    // belongs to this same account and coming back to History must not blank the
    // grid. It is replaced by what the store returns, never merged with it, so
    // nothing stale can survive the read. Only an account change clears it.
    render();

    // The whole record, in one read: there is no period to bound it to and no
    // pagination, so the grid can run back to wherever the earliest entry is.
    const outcome = await logStore.historyWindow(HISTORY_RECORD_START, historyToday);
    if (token !== historyToken) return;

    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }
    if (outcome.kind === 'retry') {
      // No grid at all rather than a stale one, and it says why.
      historyMessage = outcome.message;
      render();
      return;
    }

    historyWindow = outcome.window;
    render();
  };

  const openHistorySection = async (): Promise<void> => {
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
    screen = 'history';
    await loadHistory();
  };

  /**
   * The meals a lookup matches over: every meal the account recorded, read through
   * the port with no account identifier anywhere, so row-level security is the only
   * thing that decides whose meals a lookup can reach.
   */
  const loadLookup = async (): Promise<boolean> => {
    const token = ++lookupToken;
    const outcome = await logStore.mealHistory();
    // A read for an earlier account, or an earlier attempt, must not land here.
    if (token !== lookupToken) return false;

    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return false;
    }
    if (outcome.kind === 'retry') {
      // No results at all rather than results over half a log, and it says why.
      lookupMeals = null;
      lookupMessage = outcome.message;
      return true;
    }

    lookupMeals = outcome.meals;
    lookupMessage = null;
    return true;
  };

  /** Reading again after a failure, from the screen's own Try again control. */
  const retryLookup = async (): Promise<void> => {
    if (await loadLookup()) render();
  };

  /**
   * The meals are read BEFORE the screen is shown, exactly as the night list and
   * the pad's chips are. A search box that appeared while its material was still
   * in flight would either answer a word over half a log or quietly lose it.
   */
  const openLookupSection = async (): Promise<void> => {
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    // A fresh search each time the section is opened: coming back to Lookup asks
    // what the person is looking for now, rather than answering an older question.
    lookupQuery = '';
    lookupTab = 'food';
    lookupTarget = '';
    lookupWindow = DEFAULT_CHANGE_WINDOW;
    lookupStartTarget = '';
    lookupStartWindow = DEFAULT_START_WINDOW;
    lookupMeals = null;
    lookupMessage = null;
    if (!(await loadLookup())) return;
    screen = 'lookup';
    render();
  };

  /** The bottom navigation: the three sections this brief has built so far. */
  const goTo = (tab: ShellTab): void => {
    // The grid's place is kept as it is left, whichever way it is left.
    if (screen === 'history') rememberHistoryScroll();
    if (tab === 'history') {
      void openHistorySection();
      return;
    }
    if (tab === 'lookup') {
      void openLookupSection();
      return;
    }
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
    screen = 'day';
    date = localToday();
    void loadDayLog();
  };

  /**
   * A night cell opens the night screen for ITS OWN night, which is the record
   * dated the day before the row it sits in. The date being read moves with it,
   * because the night screen records against the date the frame is on, and the
   * day is read first so the screen opens on the night already there rather than
   * on a blank one that would overwrite it.
   */
  const openNightFor = async (nightOn: IsoDate): Promise<void> => {
    const outcome = await logStore.dayLog(nightOn);
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }

    // An in-flight day read for another date must not land on top of this one.
    readToken += 1;
    date = nightOn;

    if (outcome.kind !== 'loaded') {
      // Say so rather than returning quietly: a control that opens nothing
      // cannot be told from a missed tap.
      clearDetail();
      dayLogState = { kind: 'failed', message: outcome.message };
      screen = 'day';
      render();
      return;
    }

    clearDetail();
    dayLogState = { kind: 'loaded', log: outcome.log };
    // Opened from the grid, so the night screen keeps History's navigation: that
    // is how the row it was opened from is got back to.
    await openNight('history');
  };

  /**
   * That meal's own EDIT form, opened from a History cell. The meal is read BY ITS
   * ID rather than looked up in whatever day happens to be loaded, and the date it
   * records against is the cell's own date, so finishing an entry from the grid
   * cannot move the meal to another day.
   */
  const editMealFromHistory = async (id: string, eatenOn: IsoDate): Promise<void> => {
    const found = await logStore.meal(id);
    if (found.kind === 'session-ended') {
      await endSession(found.message);
      return;
    }
    if (found.kind !== 'loaded') {
      // Say so rather than returning quietly: a control that opens nothing cannot
      // be told from a missed tap.
      clearDetail();
      detailRefusal = found.message;
      screen = 'detail';
      render();
      return;
    }

    if (!(await loadRecentMeals(eatenOn))) return;
    if (!(await loadMealHistory())) return;

    readToken += 1;
    date = eatenOn;
    clearDetail();
    // The meal's id travels with the draft, so adding the after reading later
    // updates this row rather than writing a second meal on the date.
    mealDraft = mealDraftFrom(found.meal, eatenOn);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = 'history';
    screen = 'meal';
    render();
  };

  /**
   * A new meal for the DATE and SLOT an empty History cell named. The date being
   * read moves with it, because a meal is recorded against the date the frame is
   * on, so a day kept on paper is filled in where it belongs rather than landing
   * on today. The form is opened from the grid, so it keeps History's navigation.
   */
  const newMealFromHistory = async (eatenOn: IsoDate, slot: MealSlot): Promise<void> => {
    if (!(await loadRecentMeals(eatenOn))) return;
    if (!(await loadMealHistory())) return;

    readToken += 1;
    date = eatenOn;
    clearDetail();
    // No meal id: this is a new entry, and saving writes a row on that date.
    mealDraft = newMealDraft(eatenOn, slot);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = 'history';
    screen = 'meal';
    render();
  };

  const openNight = async (from: ShellTab | undefined = undefined): Promise<void> => {
    if (dayLogState.kind !== 'loaded') return;
    const recordedNight = dayLogState.log.nightInsulin[0];
    const opening = date;

    const outcome = await logStore.recentNights(opening, NIGHT_WINDOW);
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }
    // The bedtime glucose gets the same pad, so its chips are in hand before the
    // screen is shown too.
    if (!(await loadRecentMeals(opening))) return;
    // A step to another day while the read was in flight wins: the screen must
    // never open on one date holding another date's nights.
    if (opening !== date) return;

    nightDraft =
      recordedNight === undefined
        ? newNightDraft(opening)
        : nightDraftFrom(recordedNight, opening);
    nightHistory =
      outcome.kind === 'loaded'
        ? { kind: 'loaded', rows: nightRows(outcome.window) }
        : { kind: 'failed', message: outcome.message };
    mealDraft = null;
    foodDraft = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = from;
    screen = 'night';
    render();
  };

  /**
   * The material the pad's chips are read off. A read that failed costs the
   * chips and nothing else: filling in a meal must never wait on a convenience,
   * so the form opens with a pad that simply carries no chips.
   */
  const loadRecentMeals = async (upTo: IsoDate): Promise<boolean> => {
    const outcome = await logStore.recentMeals(upTo, RECENT_MEALS_WINDOW);
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return false;
    }
    recentMeals = outcome.kind === 'loaded' ? outcome.meals : [];
    return true;
  };

  /**
   * The material the expected-after estimate is read off: every meal this account
   * recorded. A read that failed costs the estimate and nothing else -- filling in a
   * meal never waits on it -- but it is reported rather than swallowed, because an
   * empty history and an unread one say very different things.
   */
  const loadMealHistory = async (): Promise<boolean> => {
    const outcome = await logStore.mealHistory();
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return false;
    }
    mealHistory = outcome.kind === 'loaded' ? outcome.meals : [];
    mealHistoryMessage = outcome.kind === 'loaded' ? null : outcome.message;
    return true;
  };

  const logSlot = async (slot: MealSlot): Promise<void> => {
    const opening = date;
    if (!(await loadRecentMeals(opening))) return;
    if (!(await loadMealHistory())) return;
    // A step to another day while the read was in flight wins, exactly as it
    // does for the night screen.
    if (opening !== date) return;

    // The slot comes through already chosen, and the meal is recorded against the
    // date being read rather than against the server's idea of now.
    mealDraft = newMealDraft(opening, slot);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    formSection = undefined;
    screen = 'meal';
    render();
  };

  const editMeal = async (id: string): Promise<void> => {
    if (dayLogState.kind !== 'loaded') return;
    const meal = dayLogState.log.meals.find((candidate) => candidate.id === id);
    if (meal === undefined) return;

    const opening = date;
    if (!(await loadRecentMeals(opening))) return;
    if (!(await loadMealHistory())) return;
    if (opening !== date) return;

    // Carrying the meal's id is what makes the save update this row, so adding the
    // after reading later cannot produce a second meal on the date.
    mealDraft = mealDraftFrom(meal, opening);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    formSection = undefined;
    screen = 'meal';
    render();
  };

  /**
   * The same foods again, as a new meal on TODAY -- whichever date was browsed to
   * find the source. Repeating a meal is something done when eating it again, so
   * the entry belongs to the day it is made on, and the date being read moves with
   * it rather than leaving the form recording against a day in the past.
   *
   * Nothing of the source but its foods and its slot travels, and the source row
   * is neither carried nor touched: the draft has no meal id, so saving writes a
   * second record and the first keeps its own readings, dose, context and note.
   */
  const logAgain = async (source: Meal): Promise<void> => {
    const opening = localToday();
    if (!(await loadRecentMeals(opening))) return;
    if (!(await loadMealHistory())) return;

    date = opening;
    mealDraft = repeatMealDraft(source, opening);
    clearDetail();
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    formSection = undefined;
    screen = 'meal';
    render();
  };

  const clearDetail = (): void => {
    detailMeal = null;
    detailInstances = [];
    detailMessage = null;
    detailRefusal = null;
  };

  /**
   * The meal detail, reached from a card's body on Today. The whole history is
   * read through the port and the domain decides which of those meals are
   * instances of these foods, so the rule for sameness is not buried in a query.
   * A history that could not be read says so rather than reading as a meal eaten
   * once.
   */
  const openMealDetail = async (id: string): Promise<void> => {
    // The meal is read BY ITS ID, never looked up in whatever day log happens
    // to be loaded: a snapshot of one date cannot answer for a meal on another,
    // and a lookup that missed could only return quietly.
    const found = await logStore.meal(id);
    if (found.kind === 'session-ended') {
      await endSession(found.message);
      return;
    }

    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    screen = 'detail';

    // Either the detail, or why not. Never nothing.
    if (found.kind !== 'loaded') {
      detailRefusal = found.message;
      render();
      return;
    }

    const meal = found.meal;
    const outcome = await logStore.mealHistory();
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }

    detailMeal = meal;
    detailInstances =
      outcome.kind === 'loaded' ? instancesOf(outcome.meals, meal.foods, meal.id) : [];
    detailMessage = outcome.kind === 'loaded' ? null : outcome.message;
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    screen = 'detail';
    render();
  };

  const backToDay = (): void => {
    clearDetail();
    screen = 'day';
    render();
  };

  /**
   * Back to the grid already in hand, deliberately WITHOUT another read: the
   * material is the same material, and a read landing a moment later would redraw
   * the grid underneath the person and take the restored scroll position with it.
   */
  const showHistory = (): void => {
    screen = 'history';
    render();
  };

  /**
   * Leaving a form -- by Cancel, or by any other way out -- returns to the screen
   * it was opened FROM rather than to Today. A cell tapped in History leads to the
   * edit form and back to History, at the same scroll position; sending every exit
   * to Today throws away where the person was.
   */
  const leaveForm = (): void => {
    const from = formSection;
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
    if (from === 'history') {
      showHistory();
      return;
    }
    if (from === 'lookup') {
      screen = 'lookup';
      render();
      return;
    }
    screen = 'day';
    render();
  };

  const openFoodForm = (): void => {
    foodDraft = emptyFoodDraft;
    formMessage = null;
    // The pad belongs to the field it was opened on; leaving that screen closes
    // it rather than carrying it to the next one.
    padTarget = null;
    screen = 'food';
    render();
  };

  const backToMeal = (): void => {
    foodDraft = null;
    formMessage = null;
    padTarget = null;
    screen = 'meal';
    render();
  };

  const removeFood = (index: number): void => {
    if (mealDraft === null) return;
    mealDraft = withoutFood(mealDraft, index);
    render();
  };

  /** The Add food screen hands its food back to the meal being filled in. */
  const keepFood = (): void => {
    if (foodDraft === null || mealDraft === null) return;
    const refusal = foodDraftRefusal(foodDraft);
    if (refusal !== null) {
      formMessage = refusal;
      render();
      return;
    }
    mealDraft = withFood(mealDraft, foodDraft);
    backToMeal();
  };

  const saveMeal = async (): Promise<void> => {
    const draft = mealDraft;
    if (draft === null || saving) return;

    const recording = mealRecording(draft);
    if (recording === null) {
      // Refused in place: the screen stays, says why, and nothing is written.
      formMessage = mealDraftRefusal(draft);
      render();
      return;
    }

    saving = true;
    formMessage = null;
    render();

    const outcome = await logStore.saveMeal(recording);
    saving = false;

    if (outcome.kind === 'saved') {
      // Back to the screen the form was opened FROM, and what it shows is re-read:
      // the new card, or the newly filled cell, is what the store holds rather than
      // what the form believed it wrote.
      const from = formSection;
      mealDraft = null;
      foodDraft = null;
      formMessage = null;
      padTarget = null;
      formSection = undefined;
      if (from === 'history') {
        void openHistorySection();
        return;
      }
      screen = 'day';
      void loadDayLog();
      return;
    }

    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }

    // A refusal or a retry keeps every value the person entered on screen.
    formMessage = outcome.message;
    render();
  };

  const saveNight = async (): Promise<void> => {
    const draft = nightDraft;
    if (draft === null || saving) return;

    const recording = nightRecording(draft);
    if (recording === null) {
      // Refused in place: the screen stays, says why, and nothing is written, so
      // the night already on the date is untouched by the refusal.
      formMessage = nightDraftRefusal(draft);
      render();
      return;
    }

    saving = true;
    formMessage = null;
    render();

    const outcome = await logStore.saveNight(recording);
    saving = false;

    if (outcome.kind === 'saved') {
      // Back to the screen the night was opened FROM, and what it shows is re-read:
      // the night card, or the grid's night column, shows what the store holds
      // rather than what the form believed it wrote.
      const from = formSection;
      nightDraft = null;
      nightHistory = null;
      formMessage = null;
      nightPadOpen = false;
      formSection = undefined;
      if (from === 'history') {
        void openHistorySection();
        return;
      }
      screen = 'day';
      void loadDayLog();
      return;
    }

    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }

    // A refusal or a retry keeps every value the person entered on screen.
    formMessage = outcome.message;
    render();
  };

  const endSession = async (message: string): Promise<void> => {
    await identity.signOut();
    account = null;
    screen = 'day';
    // A meal and its history belong to the account that recorded them, so they
    // go with it rather than staying on screen for whoever signs in next.
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    saving = false;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
    // Readings belong to the account that recorded them, so they go with it.
    recentMeals = [];
    // So does the history an estimate would be built from: no estimate may ever be
    // based on another account's meal.
    mealHistory = [];
    mealHistoryMessage = null;
    // A grid is made of the account's own readings, so it goes with the account.
    historyToken += 1;
    historyWindow = null;
    historyMessage = null;
    historyView = 'before';
    // Where the previous person had scrolled to goes with their grid.
    historyScroll = 0;
    // So do the meals a lookup matches over, and what was typed to search them: a
    // lookup may never reach a meal of the account that has just left.
    lookupToken += 1;
    lookupMeals = null;
    lookupMessage = null;
    lookupQuery = '';
    lookupTab = 'food';
    lookupTarget = '';
    lookupWindow = DEFAULT_CHANGE_WINDOW;
    lookupStartTarget = '';
    lookupStartWindow = DEFAULT_START_WINDOW;
    signInState = { ...emptySignInState, message };
    render();
  };

  const loadDayLog = async (): Promise<void> => {
    const token = ++readToken;
    dayLogState = { kind: 'loading' };
    render();

    const outcome = await logStore.dayLog(date);
    if (token !== readToken) return;

    if (outcome.kind === 'loaded') {
      dayLogState = { kind: 'loaded', log: outcome.log };
      render();
      return;
    }
    if (outcome.kind === 'retry') {
      dayLogState = { kind: 'failed', message: outcome.message };
      render();
      return;
    }
    await endSession(outcome.message);
  };

  /**
   * Stepping the day re-reads through the same port. The log has no future, so a
   * step past today is refused here as well as being disabled on screen.
   */
  const moveDay = (days: number): void => {
    const next = shiftDate(date, days);
    if (next > localToday()) return;
    date = next;
    void loadDayLog();
  };

  /**
   * Called both by a fresh sign-in and by the client's own auth state change
   * event. A token refresh reports the same account, and must not throw away the
   * day log already on screen, so only a real change of account re-renders.
   */
  const showAccount = (next: Account | null): void => {
    if ((account?.id ?? null) === (next?.id ?? null)) return;
    account = next;
    readToken += 1;
    // A draft belongs to the person who was filling it in, so a change of hands
    // takes it with it rather than offering it to whoever signs in next.
    screen = 'day';
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    saving = false;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
    // A change of hands takes the previous person's readings with it: a chip must
    // never repeat a reading that belongs to somebody else.
    recentMeals = [];
    // The same goes for the history an estimate would be built from.
    mealHistory = [];
    mealHistoryMessage = null;
    // And for the grid: it may never hold a reading of the previous account's.
    historyToken += 1;
    historyWindow = null;
    historyMessage = null;
    historyView = 'before';
    // And where the previous person had scrolled to in it.
    historyScroll = 0;
    // And for the lookup: a search may never match a meal of the previous account's.
    lookupToken += 1;
    lookupMeals = null;
    lookupMessage = null;
    lookupQuery = '';
    lookupTab = 'food';
    lookupTarget = '';
    lookupWindow = DEFAULT_CHANGE_WINDOW;
    lookupStartTarget = '';
    lookupStartWindow = DEFAULT_START_WINDOW;
    if (account === null) {
      render();
      return;
    }
    // A session that has just changed hands opens on its own today, never on a
    // date the previous reader had stepped to.
    date = localToday();
    void loadDayLog();
  };

  const submit = async (credentials: Credentials): Promise<void> => {
    signInState = { message: null, email: credentials.email, busy: true };
    render();

    const outcome = await identity.signIn(credentials);
    if (outcome.kind === 'signed-in') {
      showAccount(outcome.account);
      return;
    }
    // A refusal clears the password by rebuilding the field; a retry keeps the
    // email filled and makes the button usable again. Both are this one render.
    signInState = { message: outcome.message, email: credentials.email, busy: false };
    render();
  };

  const signOut = async (): Promise<void> => {
    signInState = emptySignInState;
    await identity.signOut();
    showAccount(null);
  };

  identity.onChange(showAccount);
  render();

  void identity.currentAccount().then(showAccount);
};

start();
