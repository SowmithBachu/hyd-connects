// Profile status badges.
//
// The people in the city come only from the live directory (server/api.js): someone
// appears once they have completed registration. There is no built-in or sample
// directory in the app. For local testing, src/dev/samples.js can be loaded with
// /?demo on the dev server; it is never part of a production build.
//
// status drives the badge: 'open' -> "Open to work", 'hiring' -> "Hiring".

export const STATUS = {
  open: { label: 'Open to work', color: '#2fd07a' },
  hiring: { label: 'Hiring', color: '#ff9a3c' },
};
