/*
 * Public Firebase web configuration for sign-in. These values are meant to be
 * public (they identify the project, they don't grant access); the project is
 * protected by its Authorized Domains list and an HTTP-referrer restriction on
 * the API key. Fill them in from Firebase console → Project settings → Your apps.
 *
 * While apiKey is empty the shell shows "Sign-in isn't set up yet" and only
 * offers guest mode. The server side needs FIREBASE_PROJECT_ID set to the same
 * projectId.
 */
window.MOZU_FIREBASE = {
  apiKey: 'AIzaSyBJj37svX5Dt7f_NnO-5YOlTKj4FngtSOA',
  authDomain: 'roommuse-c02cb.firebaseapp.com',
  projectId: 'roommuse-c02cb',
};
