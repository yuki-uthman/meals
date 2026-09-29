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
  CHOOSE_OR_CREATE,
  NEEDS_TYPE,
  ownedFood,
  withCatalogueFood,
  type CatalogueFood,
} from './domain/food-catalogue';
import {
  emptyFoodDraft,
  mealDraftFrom,
  mealDraftRefusal,
  mealRecording,
  newMealDraft,
  NO_FOOD_NAME_REFUSAL,
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
import { FOOD_FORM_TITLE, foodForm, type NameState } from './ui/food-form';
import {
  BACK_TO_HISTORY_LABEL,
  BACK_TO_LOOKUP_LABEL,
  mealDetailScreen, mealMissingScreen } from './ui/meal-detail';
import { mealForm, mealFormTitle, type MealPadChips, type MealPadTarget } from './ui/meal-form';
import { nightForm, NIGHT_FORM_TITLE, type NightHistory } from './ui/night-form';
import { historyScreen, HISTORY_SCROLLER_CLASS, type HistoryState } from './ui/history';
import { lookupScreen, type LookupState, type LookupTab } from './ui/lookup';
import {
  DEFAULT_CHANGE_WINDOW,
  DEFAULT_START_WINDOW,
  type ChangeWindow,
  type StartWindow,
} from './domain/nearest-lookup';
import { shell, type ShellHandlers, type ShellState, type ShellTab } from './ui/shell';
import { emptySignInState, signInScreen, type SignInState } from './ui/sign-in';

const mount = (): HTMLElement => {
  const root = document.getElementById('app');
  if (root === null) throw new Error('Missing #app mount point');
  return root;
};

/** A name still being worked out: neither one of the person's foods nor a new one. */
const TYPED_NAME: NameState = { kind: 'typed' };

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
   * Whether the next render REPLACES the current history entry rather than pushing
   * one. True for the very first screen, so Back from it leaves the site as the
   * person expects rather than cycling inside the app, and true again for the
   * sign-in screen a sign-out lands on, so Back cannot walk into a screen belonging
   * to the account that just left.
   */
  let replaceNextEntry = true;
  /**
   * The route the app was ASKED for, captured ONCE here -- before anything renders
   * -- together with that entry's own state. Measured otherwise: reloading
   * #meal/<id> rendered the default day screen first, which rewrote the address to
   * #today/<date>, and the route then resolved to the address the app had just
   * invented rather than the one the person opened. A router that reads the address
   * after its own first paint is reading its own output.
   *
   * It stays pending until it has been resolved for a signed-in person, so a link
   * reopened without a session is not lost to signing in.
   */
  let pendingRoute: { readonly hash: string; readonly state: unknown } | null = {
    hash: window.location.hash,
    state: window.history.state,
  };
  /**
   * Whether that first resolution has finished. Until it has, NO render may write
   * the route: a render that wrote one would be the output the router then read.
   */
  let routeResolved = false;
  /**
   * True while a screen is being rebuilt FROM a history entry -- the Back gesture,
   * or a cold load of a route. Nothing is pushed or replaced while it is: the entry
   * the browser is already on is the one the screen belongs to.
   */
  let restoringRoute = false;
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
  /**
   * The section the detail was opened FROM, when it was not the day log. It keeps
   * that section's navigation and names it on the way back, and an edit made from
   * the detail returns to it on saving.
   */
  let detailSection: ShellTab | undefined = undefined;
  let mealDraft: MealDraft | null = null;
  let foodDraft: FoodDraft | null = null;
  /**
   * The signed-in account's own foods, read before the Add food screen is shown and
   * re-read every time it is: what is offered must be what the store holds, never
   * what an abandoned screen was holding. Held here rather than in the screen for
   * the same reason a draft is -- the screen is a pure function of it.
   */
  let catalogue: readonly CatalogueFood[] = [];
  /**
   * What the name field currently is: a name being typed, one of the account's own
   * foods, or a name the person has asked to make a food of. Nothing moves to the
   * last on its own, which is what keeps a name one letter off an existing food from
   * quietly becoming a second entry.
   */
  let foodNameState: NameState = TYPED_NAME;
  /** Guards the one write a food creation makes against a second press of Save. */
  let creatingFood = false;
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

  /**
   * The frame a detail sits in. Opened from History or Lookup it says that section
   * rather than a date: the date being read there is not the meal's, so naming it
   * would be a small untruth, and stepping it would mean nothing.
   */
  const detailFrame = (): ShellState => {
    if (detailSection === 'history') {
      return { date, isToday: date === localToday(), heading: 'History', tab: 'history' };
    }
    if (detailSection === 'lookup') {
      return { date, isToday: date === localToday(), heading: 'Lookup', tab: 'lookup' };
    }
    return { date, isToday: date === localToday() };
  };

  const detailBackLabel = (): string | undefined =>
    detailSection === 'history'
      ? BACK_TO_HISTORY_LABEL
      : detailSection === 'lookup'
        ? BACK_TO_LOOKUP_LABEL
        : undefined;

  const missingScreen = (message: string): HTMLElement =>
    shell(
      detailFrame(),
      dayHandlers,
      mealMissingScreen(message, { onBack: () => backToDay(), backLabel: detailBackLabel() }),
    );

  const detailScreen = (meal: Meal): HTMLElement =>
    shell(
      detailFrame(),
      dayHandlers,
      mealDetailScreen(
        { meal, instances: detailInstances, message: detailMessage },
        {
          onBack: () => backToDay(),
          backLabel: detailBackLabel(),
          // The meal's own day is what the edit records against, wherever the
          // detail was opened from, so correcting it can never move it.
          onEdit: () => void editMealFromHistory(meal.id, null, detailSection),
          onLogAgain: () => void logAgain(meal),
        },
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
          onAddFood: () => void openFoodForm(),
          onRemoveFood: (index) => removeFood(index),
        },
      ),
    );

  const foodScreen = (draft: FoodDraft): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), form: { title: FOOD_FORM_TITLE, busy: false } },
      { ...dayHandlers, onCancel: () => backToMeal(), onSave: () => void keepFood() },
      foodForm(
        { draft, message: formMessage, catalogue, name: foodNameState },
        {
          onName: (name) => patchFood({ name }),
          onFoodType: (foodType: FoodType) => patchFood({ foodType }),
          onAmount: (amount) => patchFood({ amount }),
          onUnit: (unit: AmountUnit) => patchFood({ unit }),
          onChoose: (food) => chooseFood(food),
          onCreate: () => createFood(),
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
              // A slot cell opens that meal's DETAIL, exactly as a Today card does.
              // Looking is the common case; the detail's Edit control is one tap
              // further, and is where the after reading taken later gets added.
              void openMealDetail(target.id, 'history');
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
          onOpen: (id) => void openMealDetail(id, 'lookup'),
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

  /**
   * What the grid's rows scroll inside. Deliberately NOT the document: the History
   * page does not scroll, the rows scroll within their own container beneath the
   * pinned column headers, so remembering and restoring a window offset would
   * restore nothing and returning from a cell would land at the top of ninety rows
   * again -- the very thing the restoration exists to prevent.
   */
  const scroller = (): Element | null =>
    document.querySelector(`.${HISTORY_SCROLLER_CLASS}`);

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

  // --------------------------------------------------------------- the route
  //
  // A screen's identity lives in the URL as a HASH route, and its transient
  // position -- the scroll offset -- lives in that entry's own state. A hash route
  // rather than a path because this front end is a static bundle on a static host:
  // a path route would need server rewriting nothing here can do, and would fail on
  // reload. In-app navigation goes through the browser's history, so the device's
  // Back gesture pops an entry and returns to the previous screen instead of
  // leaving the site -- on Android Back is the primary way people move around.

  /** A moment as the reader's own calendar date, never the server's. */
  const localDateOf = (at: Date): IsoDate =>
    [
      String(at.getFullYear()).padStart(4, '0'),
      String(at.getMonth() + 1).padStart(2, '0'),
      String(at.getDate()).padStart(2, '0'),
    ].join('-');

  /** What the screen the person is on calls itself. */
  const routeFor = (): string => {
    if (account === null) return '#signin';
    if (screen === 'history') return '#history';
    if (screen === 'lookup') return `#lookup/${lookupTab}`;
    if (screen === 'night') return `#night/${date}`;
    if (screen === 'food') return '#food';
    if (screen === 'detail') {
      // The section it was opened from is part of its name, so coming back to it
      // -- by Cancel from its edit form, or by Back -- keeps that section's frame.
      if (detailMeal === null) return '#detail';
      return detailSection === undefined
        ? `#detail/${detailMeal.id}`
        : `#detail/${detailMeal.id}/${detailSection}`;
    }
    if (screen === 'meal' && mealDraft !== null) {
      // A new entry is named by the date and slot it is being recorded against, so
      // a backfill reached through Back is the same backfill; an edit is named by
      // the meal's own id, which is what lets that meal's URL reload to it.
      return mealDraft.mealId === null
        ? `#new-meal/${mealDraft.date}/${mealDraft.slot}`
        : `#meal/${mealDraft.mealId}`;
    }
    return `#today/${date}`;
  };

  /** The position this entry should be restored to when it is come back to. */
  const entryState = (): { readonly scroll: number } => ({ scroll: historyScroll });

  /**
   * Publishes the screen as an entry. The same screen redrawn keeps its entry; a
   * different screen pushes one, after the entry being left is given the position
   * it was left at, so coming back restores it rather than starting at the top.
   */
  const syncRoute = (): void => {
    // Nothing is written while a screen is being rebuilt from an entry, and nothing
    // at all before the route the app was asked for has been resolved: the address
    // is the question until then, never the answer.
    if (restoringRoute || !routeResolved) return;
    const route = routeFor();
    const current = window.location.hash;
    if (current === route) {
      // The same screen redrawn keeps its entry, and a replacement asked for is
      // answered by it: the flag is consumed here too, because exactly ONE
      // navigation replaces its entry and a flag that survives its one intended
      // use would turn every later Back into an exit from the site.
      replaceNextEntry = false;
      window.history.replaceState(entryState(), '', route);
      return;
    }
    if (replaceNextEntry) {
      replaceNextEntry = false;
      window.history.replaceState(entryState(), '', route);
      return;
    }
    window.history.replaceState(entryState(), '', current === '' ? route : current);
    window.history.pushState(entryState(), '', route);
  };

  /**
   * Which screens manage their own scrolling. History is a vertical layout that
   * fits the viewport -- the grid scrolls within it, beneath pinned column headers
   * -- so the page itself must not scroll on it. Every other screen scrolls the
   * page as it always did, which is how a long form reaches its lowest control.
   */
  const fitsViewport = (): boolean => account !== null && screen === 'history';

  const render = (): void => {
    // Set before the screen is drawn, so the grid is laid out inside a container
    // that is already the height it will keep and the restored offset is clamped
    // against the rows' real height rather than against a page-tall box.
    document.documentElement.classList.toggle('fits-viewport', fitsViewport());
    root.replaceChildren(
      account === null
        ? signInScreen(signInState, { onSubmit: (credentials) => void submit(credentials) })
        : signedInScreen(),
    );
    syncRoute();
    if (account !== null && screen === 'history') restoreHistoryScroll();
  };

  /**
   * One way back, used by both the control and the gesture, so the two cannot
   * drift apart and the scroll restoration does not have to be written twice.
   */
  const goBack = (): void => {
    window.history.back();
  };

  /** Everything a screen was holding that the next screen must not inherit. */
  const clearTransient = (): void => {
    clearDetail();
    mealDraft = null;
    foodDraft = null;
    // What the name field was belongs to the Add food screen being left.
    foodNameState = TYPED_NAME;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = undefined;
  };

  const rememberedScroll = (state: unknown): number | null => {
    if (typeof state !== 'object' || state === null || !('scroll' in state)) return null;
    const offset = Number((state as { readonly scroll: unknown }).scroll);
    return Number.isFinite(offset) ? offset : null;
  };

  const isLookupTab = (value: string | undefined): value is LookupTab =>
    value === 'food' || value === 'change' || value === 'start';

  const isSlot = (value: string | undefined): value is MealSlot =>
    value === 'breakfast' || value === 'lunch' || value === 'dinner';

  /**
   * Rebuilds the screen an entry names. Called by the Back gesture and by a cold
   * load of a URL, which is the same question: what screen is this entry?
   *
   * Where the material is already in hand the screen is redrawn from it, because a
   * read landing a moment later would redraw it underneath the person and take the
   * restored position with it. Where it is not -- a meal's own URL asked for cold
   * -- it is read.
   */
  const applyRoute = async (hash: string, state: unknown): Promise<void> => {
    if (account === null) {
      // Back after signing out cannot walk into a screen belonging to the account
      // that just left: whatever entry the gesture reached, this app has the
      // sign-in screen, and the entry is replaced with its own route.
      screen = 'day';
      replaceNextEntry = true;
      render();
      return;
    }

    const [name, first, second] = hash.replace(/^#/, '').split('/');

    restoringRoute = true;
    // The entry being restored is the one the screen belongs to, so nothing is
    // pushed and nothing replaced: whatever asked for a replacement is answered.
    replaceNextEntry = false;
    try {
      if (name === 'history') {
        clearTransient();
        const offset = rememberedScroll(state);
        if (offset !== null) historyScroll = offset;
        screen = 'history';
        if (historyWindow === null && historyMessage === null) {
          await loadHistory();
          return;
        }
        render();
        return;
      }

      if (name === 'lookup') {
        clearTransient();
        if (isLookupTab(first)) lookupTab = first;
        if (lookupMeals === null && lookupMessage === null) {
          if (!(await loadLookup())) return;
        }
        screen = 'lookup';
        render();
        return;
      }

      if (name === 'meal' && first !== undefined) {
        // The draft in hand IS this meal when its id matches -- coming back from
        // the Add food screen, say -- so what was filled in survives the gesture.
        if (mealDraft !== null && mealDraft.mealId === first) {
          foodDraft = null;
          formMessage = null;
          padTarget = null;
          screen = 'meal';
          render();
          return;
        }
        // No date in the route: the meal's own day is what it records against.
        await editMealFromHistory(first, null);
        return;
      }

      if (name === 'new-meal' && first !== undefined && isSlot(second)) {
        if (mealDraft !== null && mealDraft.mealId === null && mealDraft.date === first) {
          foodDraft = null;
          formMessage = null;
          padTarget = null;
          screen = 'meal';
          render();
          return;
        }
        await newMealFromHistory(first, second);
        return;
      }

      if (name === 'food' && mealDraft !== null) {
        // A screen rebuilt from an entry with no draft in hand is a fresh Add food,
        // so its name is a name being typed and its catalogue is read.
        if (foodDraft === null) {
          if (!(await loadFoodCatalogue())) return;
          foodDraft = emptyFoodDraft;
          foodNameState = TYPED_NAME;
        }
        formMessage = null;
        padTarget = null;
        screen = 'food';
        render();
        return;
      }

      if (name === 'night' && first !== undefined) {
        if (nightDraft !== null && nightHistory !== null && date === first) {
          formMessage = null;
          nightPadOpen = false;
          screen = 'night';
          render();
          return;
        }
        await openNightFor(first);
        return;
      }

      if (name === 'detail' && first !== undefined) {
        const from = second === 'history' || second === 'lookup' ? second : undefined;
        if (detailMeal !== null && detailMeal.id === first && detailSection === from) {
          screen = 'detail';
          render();
          return;
        }
        await openMealDetail(first, from);
        return;
      }

      if (name === 'today' && first !== undefined) {
        clearTransient();
        date = first;
        screen = 'day';
        await loadDayLog();
        return;
      }

      // An entry this app does not recognise, and the very first signed-in screen:
      // the day log on the reader's own today, replacing rather than pushing.
      clearTransient();
      date = localToday();
      screen = 'day';
      restoringRoute = false;
      replaceNextEntry = true;
      await loadDayLog();
    } finally {
      restoringRoute = false;
    }
  };

  /**
   * Resolves the route the app was ASKED for, from what was captured at startup
   * rather than from whatever the address says by now, and only then lets a render
   * write the address again. The screen that answered it REPLACES the current entry,
   * so Back from the first screen leaves the site as the person expects.
   *
   * A route that is written but never read is a route in name only: reading it is
   * what makes a URL reloadable, bookmarkable and safe to reopen from a home-screen
   * shortcut.
   */
  const resolveFirstRoute = async (): Promise<void> => {
    const asked = pendingRoute;
    pendingRoute = null;
    await applyRoute(asked?.hash ?? window.location.hash, asked?.state ?? window.history.state);
    routeResolved = true;
    replaceNextEntry = true;
    syncRoute();
  };

  window.addEventListener('popstate', (event) => {
    void applyRoute(window.location.hash, event.state);
  });

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
   * Back to Lookup after an edit made from one of its results. The meals are
   * re-read so the corrected entry is what the results reflect, but the question
   * being asked -- the tab, what was typed, the windows -- is kept: the person was
   * part-way through a search, not starting a new one.
   */
  const returnToLookup = async (): Promise<void> => {
    clearDetail();
    screen = 'lookup';
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
   * That meal's own EDIT form, opened from a meal detail or from the meal's own
   * URL. The meal is read BY ITS ID rather than looked up in whatever day happens
   * to be loaded, and the date it records against is the meal's own date, so
   * finishing an entry cannot move the meal to another day. `from` is the section
   * a save returns to; with none it returns to the day log for that date.
   */
  const editMealFromHistory = async (
    id: string,
    eatenOn: IsoDate | null,
    from: ShellTab | undefined = 'history',
  ): Promise<void> => {
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
      detailSection = from;
      screen = 'detail';
      render();
      return;
    }

    // A meal's own URL asked for cold names no date, so the meal's own day is what
    // it records against: an edit may never move the meal to today.
    const recordAgainst = eatenOn ?? localDateOf(found.meal.eatenAt);

    if (!(await loadRecentMeals(recordAgainst))) return;
    if (!(await loadMealHistory())) return;

    readToken += 1;
    date = recordAgainst;
    clearDetail();
    // The meal's id travels with the draft, so adding the after reading later
    // updates this row rather than writing a second meal on the date.
    mealDraft = mealDraftFrom(found.meal, recordAgainst);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    padTarget = null;
    nightPadOpen = false;
    formSection = from;
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
    detailSection = undefined;
  };

  /**
   * The meal detail, reached from a card's body on Today. The whole history is
   * read through the port and the domain decides which of those meals are
   * instances of these foods, so the rule for sameness is not buried in a query.
   * A history that could not be read says so rather than reading as a meal eaten
   * once.
   */
  const openMealDetail = async (id: string, from?: ShellTab): Promise<void> => {
    // The meal is read BY ITS ID, never looked up in whatever day log happens
    // to be loaded: a snapshot of one date cannot answer for a meal on another,
    // and a lookup that missed could only return quietly.
    const found = await logStore.meal(id);
    if (found.kind === 'session-ended') {
      await endSession(found.message);
      return;
    }

    clearDetail();
    detailSection = from;
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

  /** The same one way back: the screen this one was opened from, wherever that was. */
  const backToDay = (): void => {
    goBack();
  };

  /**
   * Leaving a form -- by Cancel, or by any other way out -- returns to the screen
   * it was opened FROM rather than to Today. A cell tapped in History leads to the
   * edit form and back to History, at the same scroll position; sending every exit
   * to Today throws away where the person was.
   *
   * It goes back through the browser's history rather than setting the screen
   * itself, so the control and the device's Back gesture are one way back and the
   * scroll restoration does not have to be written twice.
   */
  const leaveForm = (): void => {
    goBack();
  };

  /**
   * The foods the Add food screen offers. Read through the port with no account
   * identifier anywhere, so row-level security is the only thing that decides whose
   * foods can appear beneath the name field.
   *
   * A read that failed costs the offer and nothing else: adding a food must never
   * wait on a convenience, so the screen opens offering nothing and the food can
   * still be created.
   */
  const loadFoodCatalogue = async (): Promise<boolean> => {
    const outcome = await logStore.foodCatalogue();
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return false;
    }
    catalogue = outcome.kind === 'loaded' ? outcome.foods : [];
    return true;
  };

  /**
   * The catalogue is read BEFORE the screen is shown, exactly as the five nights and
   * the pad's chips are: a list that arrived after the person had begun typing would
   * be a moving target. It is re-read on every opening, so what is offered is what
   * the store holds rather than what the last visit to this screen was holding.
   */
  const openFoodForm = async (): Promise<void> => {
    if (!(await loadFoodCatalogue())) return;
    foodDraft = emptyFoodDraft;
    foodNameState = TYPED_NAME;
    formMessage = null;
    // The pad belongs to the field it was opened on; leaving that screen closes
    // it rather than carrying it to the next one.
    padTarget = null;
    screen = 'food';
    render();
  };

  /**
   * One of the person's own foods, chosen from the list. It fills the name and takes
   * the type, which is why the type is then stated rather than asked for again: the
   * type is a property of the food and is already answered.
   */
  const chooseFood = (food: CatalogueFood): void => {
    if (foodDraft === null) return;
    foodDraft = { ...foodDraft, name: food.name, foodType: food.foodType };
    foodNameState = { kind: 'chosen', food };
    formMessage = null;
    render();
  };

  /**
   * The typed name is to become a food. Pressing this -- and nothing else -- is what
   * makes a food new, and it is what reveals the type chooser, because a food cannot
   * enter the catalogue without a type. It writes nothing yet: the write happens when
   * the food is handed back, which is where its type is finally known.
   */
  const createFood = (): void => {
    if (foodDraft === null) return;
    foodNameState = { kind: 'creating' };
    formMessage = null;
    render();
  };

  /**
   * The food the meal records, which is the CATALOGUE's food: its own name and its
   * own type, so 'oats ' is recorded as the 'Oats' the catalogue holds and the type
   * is the food's rather than whatever the screen last showed. Only the amount and
   * the unit come from what was just typed.
   */
  const addFoodToMeal = (food: CatalogueFood, draft: FoodDraft): void => {
    if (mealDraft === null) return;
    mealDraft = withFood(mealDraft, { ...draft, name: food.name, foodType: food.foodType });
    backToMeal();
  };

  /**
   * Back to the meal the food was being added to. The food itself has already been
   * handed back to the draft, so going back through the browser's history redraws
   * the form with it: the gesture and the control leave this screen the same way.
   */
  const backToMeal = (): void => {
    goBack();
  };

  const removeFood = (index: number): void => {
    if (mealDraft === null) return;
    mealDraft = withoutFood(mealDraft, index);
    render();
  };

  /**
   * The Add food screen hands its food back to the meal being filled in -- and, when
   * the food is a new one, puts it into the catalogue on the way. The food is written
   * HERE rather than when the meal is saved, so a food created once never has to be
   * typed again even if the meal is then abandoned.
   *
   * Every refusal is refused in place: the screen stays, says why, and the name the
   * person typed is still there to correct.
   */
  const keepFood = async (): Promise<void> => {
    const draft = foodDraft;
    if (draft === null || mealDraft === null || creatingFood) return;

    const typed = draft.name.trim();
    if (typed === '') {
      formMessage = NO_FOOD_NAME_REFUSAL;
      render();
      return;
    }

    if (foodNameState.kind === 'creating') {
      if (draft.foodType === null) {
        // A food cannot enter the catalogue without a type, so nothing is written.
        formMessage = NEEDS_TYPE;
        render();
        return;
      }

      creatingFood = true;
      const outcome = await logStore.createFood(typed, draft.foodType);
      creatingFood = false;

      if (outcome.kind === 'session-ended') {
        await endSession(outcome.message);
        return;
      }
      if (outcome.kind !== 'created') {
        // Refused or unreachable: nothing was written, and the account keeps the food
        // it already has, with its own type.
        formMessage = outcome.message;
        render();
        return;
      }

      catalogue = withCatalogueFood(catalogue, outcome.food);
      addFoodToMeal(outcome.food, draft);
      return;
    }

    // Not a creation, so the name must already be one of this account's foods --
    // whether it was chosen from the list or typed out. Which food that is, is the
    // domain's rule, on the normalised name.
    const owned = ownedFood(catalogue, typed);
    if (owned === null) {
      // Nothing is created silently: the two offers are on the screen already.
      formMessage = CHOOSE_OR_CREATE;
      render();
      return;
    }

    addFoodToMeal(owned, draft);
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
      // The form is done, so its entry is replaced rather than left behind: Back
      // from what the save returns to must not reopen a form already recorded.
      replaceNextEntry = true;
      if (from === 'history') {
        void openHistorySection();
        return;
      }
      if (from === 'lookup') {
        void returnToLookup();
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
      // The night is recorded, so its entry is replaced for the same reason.
      replaceNextEntry = true;
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
    foodNameState = TYPED_NAME;
    creatingFood = false;
    // A catalogue is the account's own foods, so it goes with the account: no food
    // of the account that has just left may ever be offered to the next one.
    catalogue = [];
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
    // Signing out REPLACES the entry the account was on, so Back cannot walk into a
    // screen belonging to the account that has just left.
    replaceNextEntry = true;
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
    foodNameState = TYPED_NAME;
    creatingFood = false;
    // And the catalogue: a food of the previous account's may never be offered.
    catalogue = [];
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
      // The sign-in screen replaces the entry the previous account was on.
      replaceNextEntry = true;
      render();
      return;
    }
    // A session that has just changed hands opens on its own today, never on a
    // date the previous reader had stepped to -- unless the URL itself names a
    // screen, which is how a meal's own URL reloads to that meal. Either way the
    // entry the browser is already on is the one this screen belongs to, so it is
    // replaced rather than pushed: Back from the first screen leaves the site.
    date = localToday();
    replaceNextEntry = true;
    // The route the app was asked for, not the one it has since written: a link
    // reopened while there was no session is answered here, once the person is in.
    void resolveFirstRoute();
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

  // The app restores a position from the entry's own state; leaving the browser's
  // automatic restoration on would make the two fight over the same offset.
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  identity.onChange(showAccount);
  render();

  void identity.currentAccount().then((next) => {
    showAccount(next);
    if (account !== null) return;
    // No session, so the sign-in screen is the first screen and says so in the
    // address: replaced, not pushed, and not absent. The route the person asked for
    // stays pending until they are in, so a reopened link is not lost to signing in.
    routeResolved = true;
    replaceNextEntry = true;
    syncRoute();
  });
};

start();
