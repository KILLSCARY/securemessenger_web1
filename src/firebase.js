import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBBsHvqO8ofRHcQKMnOsA56BdLA0UaxHkI",
  authDomain: "lavamassenge.firebaseapp.com",
  projectId: "lavamassenge",
  storageBucket: "lavamassenge.firebasestorage.app",
  messagingSenderId: "655016427713",
  appId: "1:655016427713:web:c12ab85ebfd1a42591d440",
  measurementId: "G-9EEQCPVE7T"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
