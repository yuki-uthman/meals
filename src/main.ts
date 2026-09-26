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
  type MealSlot,
} from './domain/entry';
import {
  emptyFoodDraft,
  foodDraftRefusal,
  mealDraftFrom,
  mealDraftRefusal,
  mealRecording,
  newMealDraft,
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
import type { Account, Credentials } from './ports/identity';
import { dayLogSection, type DayLogState } from './ui/day-log';
import { FOOD_FORM_TITLE, foodForm } from './ui/food-form';
import { mealForm, mealFormTitle } from './ui/meal-form';
import { nightForm, NIGHT_FORM_TITLE, type NightHistory } from './ui/night-form';
import { shell, type ShellHandlers } from './ui/shell';
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
  let screen: 'day' | 'meal' | 'food' | 'night' = 'day';
  let mealDraft: MealDraft | null = null;
  let foodDraft: FoodDraft | null = null;
  let nightDraft: NightDraft | null = null;
  /**
   * The five nights the night screen lists. Read before the screen is shown, not
   * after, so the list is never a row of blanks that reads as five empty nights.
   */
  let nightHistory: NightHistory | null = null;
  /** A refusal or retry from the screen the person is on, shown in place. */
  let formMessage: string | null = null;
  let saving = false;

  const dayHandlers: ShellHandlers = {
    onSignOut: () => void signOut(),
    onPreviousDay: () => moveDay(-1),
    onNextDay: () => moveDay(1),
  };

  const todayScreen = (): HTMLElement =>
    shell(
      { date, isToday: date === localToday() },
      dayHandlers,
      dayLogSection(dayLogState, {
        onRetry: () => void loadDayLog(),
        onLogSlot: (slot) => logSlot(slot),
        onEditMeal: (id) => editMeal(id),
        onOpenNight: () => void openNight(),
      }),
    );

  const mealScreen = (draft: MealDraft): HTMLElement =>
    shell(
      { date, isToday: date === localToday(), form: { title: mealFormTitle(draft), busy: saving } },
      { ...dayHandlers, onCancel: () => leaveForm(), onSave: () => void saveMeal() },
      mealForm(
        { draft, message: formMessage },
        {
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
        form: { title: NIGHT_FORM_TITLE, busy: saving },
      },
      { ...dayHandlers, onCancel: () => leaveForm(), onSave: () => void saveNight() },
      nightForm(
        { draft, history, message: formMessage },
        {
          onUnits: (units) => patchNight({ units }),
          onTakenAt: (takenAt) => patchNight({ takenAt }),
          onBedtimeGlucose: (bedtimeGlucose) => patchNight({ bedtimeGlucose }),
        },
      ),
    );

  const signedInScreen = (): HTMLElement => {
    if (screen === 'night' && nightDraft !== null && nightHistory !== null) {
      return nightScreen(nightDraft, nightHistory);
    }
    if (screen === 'food' && foodDraft !== null) return foodScreen(foodDraft);
    if (screen === 'meal' && mealDraft !== null) return mealScreen(mealDraft);
    return todayScreen();
  };

  const render = (): void => {
    root.replaceChildren(
      account === null
        ? signInScreen(signInState, { onSubmit: (credentials) => void submit(credentials) })
        : signedInScreen(),
    );
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
  const openNight = async (): Promise<void> => {
    if (dayLogState.kind !== 'loaded') return;
    const recordedNight = dayLogState.log.nightInsulin[0];
    const opening = date;

    const outcome = await logStore.recentNights(opening, NIGHT_WINDOW);
    if (outcome.kind === 'session-ended') {
      await endSession(outcome.message);
      return;
    }
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
    screen = 'night';
    render();
  };

  const logSlot = (slot: MealSlot): void => {
    // The slot comes through already chosen, and the meal is recorded against the
    // date being read rather than against the server's idea of now.
    mealDraft = newMealDraft(date, slot);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    screen = 'meal';
    render();
  };

  const editMeal = (id: string): void => {
    if (dayLogState.kind !== 'loaded') return;
    const meal = dayLogState.log.meals.find((candidate) => candidate.id === id);
    if (meal === undefined) return;
    // Carrying the meal's id is what makes the save update this row, so adding the
    // after reading later cannot produce a second meal on the date.
    mealDraft = mealDraftFrom(meal, date);
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    screen = 'meal';
    render();
  };

  const leaveForm = (): void => {
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    screen = 'day';
    render();
  };

  const openFoodForm = (): void => {
    foodDraft = emptyFoodDraft;
    formMessage = null;
    screen = 'food';
    render();
  };

  const backToMeal = (): void => {
    foodDraft = null;
    formMessage = null;
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
      // Back to Today for the same date, and the day is re-read: the new card is
      // what the store holds rather than what the form believed it wrote.
      mealDraft = null;
      foodDraft = null;
      formMessage = null;
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
      // Back to Today for the same date, and the day is re-read: the night card
      // shows what the store holds rather than what the form believed it wrote.
      nightDraft = null;
      nightHistory = null;
      formMessage = null;
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
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    saving = false;
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
    mealDraft = null;
    foodDraft = null;
    nightDraft = null;
    nightHistory = null;
    formMessage = null;
    saving = false;
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
