/**
 * Firebase's public web config: it identifies the project to the sign-in
 * service and is meant to ship in the page (access is governed by Firebase's
 * own rules and the session cookie our API issues, not by keeping this secret).
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBJj37svX5Dt7f_NnO-5YOlTKj4FngtSOA',
  authDomain: 'roommuse-c02cb.firebaseapp.com',
  projectId: 'roommuse-c02cb',
} as const;
