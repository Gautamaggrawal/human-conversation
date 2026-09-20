import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { api } from '../api';

export function HistoryScreen({
  onBack,
  onTalkAgain,
}: {
  onBack: () => void;
  onTalkAgain: (listenerId: string) => void;
}) {
  const [calls, setCalls] = useState<any[]>([]);

  useEffect(() => {
    api('/me/calls').then((d) => setCalls(d.calls || []));
  }, []);

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>Recent conversations</Text>
      <FlatList
        data={calls}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>No calls yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.name}>{item.other_name || 'Someone'}</Text>
              <Text style={styles.meta}>
                {item.billable_seconds ? `${Math.ceil(item.billable_seconds / 60)} min` : item.status}
              </Text>
            </View>
            {item.listener_id && (
              <Pressable onPress={() => onTalkAgain(item.listener_id)}>
                <Text style={styles.action}>Talk again</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, paddingTop: 56 },
  back: { color: '#9ca3af', marginBottom: 24 },
  title: { color: '#f4f1ea', fontSize: 28, fontWeight: '700', marginBottom: 20 },
  empty: { color: '#6b7280' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a222c',
  },
  name: { color: '#f4f1ea', fontSize: 16, fontWeight: '600' },
  meta: { color: '#9ca3af', marginTop: 4 },
  action: { color: '#e85d04' },
});
