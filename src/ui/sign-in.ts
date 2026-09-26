import type { Credentials } from '../ports/identity';

// The sign-in screen as a pure function from state to a DOM subtree.
//
// The screen carries exactly one button, the submit control, so there is one
// unambiguous way to send the form.

export type SignInState = {
  /** A refusal or retry message to show, or null on a first visit. */
  readonly message: string | null;
  /** The email survives a failed attempt; the password never does. */
  readonly email: string;
  readonly busy: boolean;
};

export const emptySignInState: SignInState = { message: null, email: '', busy: false };

export type SignInHandlers = {
  readonly onSubmit: (credentials: Credentials) => void;
};

const field = (
  id: string,
  labelText: string,
  type: 'email' | 'password',
  value: string,
): { readonly wrapper: HTMLElement; readonly input: HTMLInputElement } => {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = id;
  input.name = id;
  input.type = type;
  input.value = value;
  input.required = true;
  input.autocomplete = type === 'email' ? 'username' : 'current-password';

  wrapper.append(label, input);
  return { wrapper, input };
};

export const signInScreen = (state: SignInState, handlers: SignInHandlers): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'sign-in';

  const title = document.createElement('h1');
  title.className = 'sign-in__title';
  title.textContent = 'Meal & Insulin Log';

  const form = document.createElement('form');
  form.className = 'sign-in__form';
  form.noValidate = true;

  const email = field('email', 'Email', 'email', state.email);
  const password = field('password', 'Password', 'password', '');

  const submit = document.createElement('button');
  submit.className = 'button';
  submit.type = 'submit';
  submit.textContent = state.busy ? 'Signing in…' : 'Sign in';
  submit.disabled = state.busy;

  form.append(email.wrapper, password.wrapper, submit);
  section.append(title, form);

  if (state.message !== null) {
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.setAttribute('role', 'alert');
    notice.textContent = state.message;
    section.append(notice);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) return;
    handlers.onSubmit({ email: email.input.value.trim(), password: password.input.value });
  });

  return section;
};
