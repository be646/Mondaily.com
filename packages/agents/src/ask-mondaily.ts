export async function runAskMondaily(input: { workspaceId: string; userId: string; message: string; threadId: string }) {
  return {
    textStream: (async function* () {
      yield `Ask Mondaily scaffold received: ${input.message}`;
    })()
  };
}

