const greetingExp = /^greetings:\/\/(.+)$/;

export const resourceTemplates = [
  {
    uriTemplate: "greetings://{name}",
    name: "Personal Greeting",
    description: "A personalized greeting message",
    mimeType: "text/plain",
  },
];

const greetingMatchHandler = (
  uri: string,
  matchText: RegExpMatchArray
): () => { contents: Array<{ uri: string; text: string }> } => {
  const name = decodeURIComponent(matchText[1]);
  return () => ({
    contents: [
      {
        uri,
        text: `Hello, ${name}! Welcome to MCP.`,
      },
    ],
  });
};

export const getResourceTemplate = (
  uri: string
): (() => { contents: Array<{ uri: string; text: string }> }) | null => {
  const greetingMatch = uri.match(greetingExp);
  if (greetingMatch) return greetingMatchHandler(uri, greetingMatch);
  return null;
};
