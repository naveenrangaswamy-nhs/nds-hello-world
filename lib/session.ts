/**
 * The signed-in session, if any.
 *
 * The app has no sign-in yet, so there is never a session and no journeys
 * are recorded. When authentication is added, return the session's stable
 * server-side identifier here: never a value the browser can set or change
 * unsigned, and never the user's own identity (that is `userRef`).
 */
export async function getSessionId(): Promise<string | undefined> {
  return undefined;
}
