import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { requestEmailOtp, verifyEmailOtp } from '../api';
import { USE_DEV_AUTH } from '../config';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const continueEmail = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await requestEmailOtp(email.trim());
      if (r.mode === 'dev') {
        await verifyEmailOtp(email.trim(), '000000');
        onLoggedIn();
      } else {
        setStep('code');
      }
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setError('');
    try {
      await verifyEmailOtp(email.trim(), code.trim());
      onLoggedIn();
    } catch (e: any) {
      setError(e.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.brand}>Human Conversation</Text>
      <Text style={styles.sub}>Someone to talk to, right now.</Text>

      {step === 'email' ? (
        <>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#6b7280"
            value={email}
            onChangeText={setEmail}
          />
          <Pressable style={styles.btn} onPress={continueEmail} disabled={loading || !email}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
          </Pressable>
          {USE_DEV_AUTH && (
            <Text style={styles.hint}>Dev auth: any email logs you in instantly.</Text>
          )}
        </>
      ) : (
        <>
          <Text style={styles.hint}>Enter the 6-digit code sent to {email}</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor="#6b7280"
            value={code}
            onChangeText={setCode}
            maxLength={6}
          />
          <Pressable style={styles.btn} onPress={verify} disabled={loading || code.length < 6}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify</Text>}
          </Pressable>
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, justifyContent: 'center' },
  brand: { fontSize: 32, fontWeight: '700', color: '#f4f1ea', marginBottom: 8 },
  sub: { fontSize: 16, color: '#9ca3af', marginBottom: 32 },
  input: {
    backgroundColor: '#1a222c',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a3441',
  },
  btn: {
    backgroundColor: '#e85d04',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  hint: { color: '#6b7280', marginTop: 16, fontSize: 13 },
  error: { color: '#f87171', marginTop: 12 },
});
