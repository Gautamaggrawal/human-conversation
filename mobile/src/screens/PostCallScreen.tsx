import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { api } from '../api';

type Props = {
  callId?: string;
  listenerId?: string;
  billableSeconds?: number;
  onDone: () => void;
  onTalkAgain: () => void;
};

export function PostCallScreen({ callId, listenerId, billableSeconds, onDone, onTalkAgain }: Props) {
  const [rating, setRating] = useState(5);
  const [favorite, setFavorite] = useState(true);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    if (callId && listenerId) {
      await api(`/calls/${callId}/rating`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          listener_id: listenerId,
          favorite,
          tags: rating >= 4 ? ['Good listener'] : [],
        }),
      });
    }
    setSaved(true);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>How was the conversation?</Text>
      {billableSeconds != null && (
        <Text style={styles.meta}>Billed ~{Math.ceil(billableSeconds / 60)} min</Text>
      )}
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)}>
            <Text style={[styles.star, n <= rating && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.check} onPress={() => setFavorite(!favorite)}>
        <Text style={styles.checkText}>{favorite ? '☑' : '☐'} I'd talk to them again</Text>
      </Pressable>
      {!saved ? (
        <Pressable style={styles.btn} onPress={submit}>
          <Text style={styles.btnText}>Submit</Text>
        </Pressable>
      ) : (
        <>
          <Pressable style={styles.btn} onPress={onTalkAgain}>
            <Text style={styles.btnText}>Talk to this person again</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={onDone}>
            <Text style={styles.ghostText}>Done</Text>
          </Pressable>
        </>
      )}
      {listenerId && callId && (
        <Pressable
          style={styles.ghost}
          onPress={async () => {
            await api('/reports', {
              method: 'POST',
              body: JSON.stringify({
                reported_id: listenerId,
                call_id: callId,
                reason: 'OTHER',
                details: 'Reported from post-call',
              }),
            });
            onDone();
          }}
        >
          <Text style={styles.ghostText}>Report</Text>
        </Pressable>
      )}
      {listenerId && (
        <Pressable
          style={styles.ghost}
          onPress={async () => {
            await api(`/calls/${callId}/notify-available`, {
              method: 'POST',
              body: JSON.stringify({ listener_id: listenerId }),
            });
            onDone();
          }}
        >
          <Text style={styles.ghostText}>Notify me when available</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, justifyContent: 'center' },
  title: { color: '#f4f1ea', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  meta: { color: '#9ca3af', marginBottom: 24 },
  stars: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  star: { fontSize: 36, color: '#374151' },
  starOn: { color: '#fbbf24' },
  check: { marginBottom: 24 },
  checkText: { color: '#f4f1ea', fontSize: 16 },
  btn: { backgroundColor: '#e85d04', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  ghost: { marginTop: 16, alignItems: 'center' },
  ghostText: { color: '#9ca3af' },
});
