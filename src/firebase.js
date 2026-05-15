import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyAaLeMZOh5J0N_wzzJMwF0D4tWu3kcIRyE',
  authDomain: 'ai-web-masterclass.firebaseapp.com',
  projectId: 'ai-web-masterclass',
  storageBucket: 'ai-web-masterclass.firebasestorage.app',
  messagingSenderId: '35895977653',
  appId: '1:35895977653:web:0d0843e2964b3fe3be80fc',
  // ודא את ה-URL הזה ב-Firebase Console > Realtime Database > Data tab
  databaseURL: 'https://ai-web-masterclass-default-rtdb.firebaseio.com',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const rtdb = getDatabase(app)

export default app
