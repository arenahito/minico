export type AppStage = "bootstrap";

export interface SessionState {
  readonly stage: AppStage;
  readonly appName: string;
  readonly buildTarget: "desktop";
}

export const initialSessionState: SessionState = {
  stage: "bootstrap",
  appName: "minico",
  buildTarget: "desktop",
};
