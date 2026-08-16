export const GENERATING_CHAT_TITLE = "__generating__";

export const isGeneratingChatTitle = (title: string) =>
  title === GENERATING_CHAT_TITLE;
