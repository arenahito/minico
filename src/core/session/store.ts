export interface SessionState {
  readonly appName: string;
  readonly buildTarget: "desktop";
  readonly authView: "checking" | "loggedIn" | "loginRequired";
  readonly currentThreadId: string | null;
  readonly activeTurnId: string | null;
}

export const initialSessionState: SessionState = {
  appName: "minico",
  buildTarget: "desktop",
  authView: "loginRequired",
  currentThreadId: null,
  activeTurnId: null,
};
