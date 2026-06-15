const admin = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const { initializeApp, cert } = admin;

initializeApp({
  credential: cert(serviceAccount),
});

console.log('Firebase initialized');
const db = getFirestore();
console.log('Firestore ready');

module.exports = { db };
