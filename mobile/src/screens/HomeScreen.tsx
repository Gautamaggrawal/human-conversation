import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { api } from '../api';

type Props = {
  onTalk: (duration: number, listenerId?: string) => void;
  onWallet: () => void;
  onListenerMode: () => void;
  onHistory: () => void;
};

export function HomeScreen({ onTalk, onWallet, onListenerMode, onHistory }: Props) {
  const [duration, setDuration] = useState(600);
  const [wallet, setWallet] = useState({ available: 0, held: 0 });
  const [favorites, setFavorites] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [w, f, m] = await Promise.all([
        api('/wallet'),
        api('/me/favorites'),
        api('/me'),
      ]);
      setWallet(w);
      setFavorites(f.favorites || []);
      setMe(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#e85d04" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.hello}>Hi {me?.display_name || 'there'}</Text>
        <Pressable onPress={onWallet}>
          <Text style={styles.credits}>{wallet.available} credits</Text>
        </Pressable>
      </View>

      <Text style={styles.headline}>Want to talk?</Text>

      <Pressable style={styles.talkBtn} onPress={() => onTalk(duration)}>
        <Text style={styles.talkText}>TALK NOW</Text>
      </Pressable>

      <View style={styles.durations}>
        {[600, 1200, 1800].map((d) => (
          <Pressable
            key={d}
            style={[styles.chip, duration === d && styles.chipOn]}
            onPress={() => setDuration(d)}
          >
            <Text style={[styles.chipText, duration === d && styles.chipTextOn]}>
              {d / 60} min
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Recent people</Text>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.listener_id}
        ListEmptyComponent={<Text style={styles.empty}>Favorites appear after good calls.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onTalk(duration, item.listener_id)}>
            <Text style={styles.rowTitle}>{item.display_name || 'Listener'}</Text>
            <Text style={styles.rowAction}>Talk again</Text>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <Pressable onPress={onHistory}>
          <Text style={styles.link}>History</Text>
        </Pressable>
        <Pressable onPress={onListenerMode}>
          <Text style={styles.link}>I'm a listener</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, paddingTop: 56 },
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 40 },
  hello: { color: '#9ca3af', fontSize: 15 },
  credits: { color: '#fbbf24', fontWeight: '600' },
  headline: { fontSize: 36, fontWeight: '700', color: '#f4f1ea', marginBottom: 28 },
  talkBtn: {
    backgroundColor: '#e85d04',
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: 'center',
    marginBottom: 20,
  },
  talkText: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  durations: { flexDirection: 'row', gap: 10, marginBottom: 36 },
  chip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3441',
    alignItems: 'center',
  },
  chipOn: { backgroundColor: '#1a222c', borderColor: '#e85d04' },
  chipText: { color: '#9ca3af' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  section: { color: '#9ca3af', marginBottom: 12, fontSize: 14 },
  empty: { color: '#4b5563' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a222c',
  },
  rowTitle: { color: '#f4f1ea', fontSize: 16 },
  rowAction: { color: '#e85d04' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20 },
  link: { color: '#9ca3af' },
});
