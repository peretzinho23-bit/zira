import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

const googleProvider = new GoogleAuthProvider()

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider)
  const { uid, displayName, email, photoURL } = cred.user
  await setDoc(doc(db, 'users', uid), {
    displayName,
    email,
    photoURL,
    updatedAt: Date.now(),
  }, { merge: true })
  return cred.user
}

export async function logout() {
  await signOut(auth)
}
