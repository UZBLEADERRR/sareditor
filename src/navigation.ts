export type RootStackParamList = {
  Home: undefined;
  /** `startInAi` opens the editor with the agent already in charge. */
  Editor: { projectId: string; startInAi?: boolean };
  Settings: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
