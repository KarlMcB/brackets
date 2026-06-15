const admin = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const raw = process.env.FB_CREDENTIALS
  ? Buffer.from(process.env.FB_CREDENTIALS, 'base64').toString('utf8')
  : process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccount = JSON.parse(raw);

const { initializeApp, cert } = admin;

initializeApp({
  credential: cert(serviceAccount),
});

console.log('Firebase initialized');
const db = getFirestore();
console.log('Firestore ready');

module.exports = { db };
