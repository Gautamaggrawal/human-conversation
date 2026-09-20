import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { api } from '../api';

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const [wallet, setWallet] = useState({ available: 0, held: 0, earned: 0 });

  const refresh = () => api('/wallet').then(setWallet);

  useEffect(() => {
    refresh();
  }, []);

  const buy = async (credits: number) => {
    await api('/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ credits }),
    });
    await refresh();
  };

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>Wallet</Text>
      <Text style={styles.balance}>{wallet.available}</Text>
      <Text style={styles.label}>Available credits</Text>
      {wallet.held > 0 && <Text style={styles.held}>Held: {wallet.held}</Text>}
      <Text style={styles.section}>Add credits</Text>
      {[100, 300, 500].map((c) => (
        <Pressable key={c} style={styles.btn} onPress={() => buy(c)}>
          <Text style={styles.btnText}>+{c} credits</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, paddingTop: 56 },
  back: { color: '#9ca3af', marginBottom: 24 },
  title: { color: '#f4f1ea', fontSize: 28, fontWeight: '700' },
  balance: { color: '#fbbf24', fontSize: 48, fontWeight: '700', marginTop: 16 },
  label: { color: '#9ca3af' },
  held: { color: '#f97316', marginTop: 8 },
  section: { color: '#9ca3af', marginTop: 40, marginBottom: 12 },
  btn: {
    backgroundColor: '#1a222c',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a3441',
  },
  btnText: { color: '#f4f1ea', fontWeight: '600', textAlign: 'center' },
});
