"use client";

import * as React from "react";

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 5000;

export type ToastVariant = "default" | "success" | "warning" | "danger";

export type ToastProps = {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
};

type Action =
  | { type: "ADD"; toast: ToastProps }
  | { type: "DISMISS"; toastId?: string }
  | { type: "REMOVE"; toastId?: string };

type State = { toasts: ToastProps[] };

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD":
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case "DISMISS":
      return {
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
    case "REMOVE":
      return {
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
    default:
      return state;
  }
}

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

export function toast(input: Omit<ToastProps, "id">) {
  const id = genId();
  dispatch({ type: "ADD", toast: { ...input, id } });
  window.setTimeout(() => dispatch({ type: "DISMISS", toastId: id }), TOAST_REMOVE_DELAY);
  return { id, dismiss: () => dispatch({ type: "DISMISS", toastId: id }) };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    toasts: state.toasts,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS", toastId }),
  };
}
