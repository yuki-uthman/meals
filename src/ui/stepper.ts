import { stepDose } from '../domain/number-entry';

// The dose stepper: a minus and a plus beside a dose field, each moving the dose
// by exactly one unit.
//
// Like the number pad, it writes into the field the form already declared rather
// than replacing it. The input stays typeable, because a dose of 12 must not
// cost twelve taps, and because the stepper is a convenience and never the only
// way in. It moves a number the person is choosing; it never proposes one.

export const DECREASE_DOSE = 'Decrease dose';
export const INCREASE_DOSE = 'Increase dose';

const stepButton = (
  name: string,
  face: string,
  onPress: () => void,
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.className = 'stepper__button';
  button.type = 'button';
  // The face is a symbol; the accessible name says which dose it moves and
  // which way, so it is not read out as 'minus'.
  button.setAttribute('aria-label', name);
  button.textContent = face;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => onPress());
  return button;
};

/**
 * The two controls, wrapped around the field they move. Minus at zero does
 * nothing at all: the refusal lives in the domain, and the button stays present
 * rather than disappearing at the bottom of its range.
 */
export const doseStepper = (
  field: HTMLInputElement,
  onValue: (value: string) => void,
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'stepper';

  const move = (steps: number): void => {
    const next = stepDose(field.value, steps);
    field.value = next;
    onValue(next);
  };

  row.append(
    stepButton(DECREASE_DOSE, '−', () => move(-1)),
    field,
    stepButton(INCREASE_DOSE, '+', () => move(1)),
  );
  return row;
};
