import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { api } from '../api';
import { signaling } from '../signaling';
import { AudioCallSession } from '../webrtc';

export function ListenerScreen({ onBack }: { onBack: () => void }) {
  const [online, setOnline] = useState(false);
  const [earnings, setEarnings] = useState<any>(null);
  const [incoming, setIncoming] = useState<any>(null);
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState('');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const sessionRef = useRef<AudioCallSession | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/listeners/earnings')
      .then(setEarnings)
      .catch(() => setEarnings(null));
  }, []);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      await signaling.connect();
      unsub = signaling.onMessage(async (msg) => {
        if (msg.type === 'call.incoming') {
          setIncoming(msg);
        }
        if (msg.type === 'call.state') {
          setStatus(msg.status);
          if (msg.status === 'ACTIVE') setInCall(true);
        }
        if (msg.type === 'webrtc.offer' || msg.type === 'webrtc.ice' || msg.type === 'webrtc.answer') {
          await sessionRef.current?.handleRemote(msg);
        }
        if (msg.type === 'call.ended') {
          await sessionRef.current?.stop();
          sessionRef.current = null;
          setInCall(false);
          setIncoming(null);
          setActiveCallId(null);
          setOnline(true);
          signaling.send({ type: 'listener.available' });
        }
        if (msg.type === 'error') {
          setError(msg.reason || 'error');
        }
        if (msg.type === 'listener.available.ack') {
          setOnline(true);
          setError('');
        }
      });
    })();
    return () => {
      unsub();
      signaling.send({ type: 'listener.offline' });
    };
  }, []);

  const goOnline = async () => {
    setError('');
    try {
      await api('/listeners/apply', { method: 'POST', body: '{}' });
    } catch {
      /* may already exist */
    }
    signaling.send({ type: 'listener.available' });
  };

  const accept = async () => {
    if (!incoming) return;
    setActiveCallId(incoming.call_id);
    signaling.send({ type: 'call.accept', call_id: incoming.call_id });
    const sess = new AudioCallSession(incoming.call_id, false);
    sessionRef.current = sess;
    await sess.start();
    setIncoming(null);
    setInCall(true);
  };

  const decline = () => {
    if (!incoming) return;
    signaling.send({ type: 'call.decline', call_id: incoming.call_id });
    setIncoming(null);
  };

  if (incoming) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.title}>Someone wants to talk</Text>
        <Text style={styles.sub}>{incoming.duration / 60} minutes</Text>
        <Pressable style={styles.accept} onPress={accept}>
          <Text style={styles.btnText}>ACCEPT</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={decline}>
          <Text style={styles.ghostText}>Decline</Text>
        </Pressable>
      </View>
    );
  }

  if (inCall) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.title}>On a call</Text>
        <Text style={styles.sub}>{status}</Text>
        <Pressable
          style={styles.end}
          onPress={() => signaling.send({ type: 'call.end', call_id: activeCallId })}
        >
          <Text style={styles.btnText}>End</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>{online ? "You're online" : "You're offline"}</Text>
      <Pressable
        style={styles.btn}
        onPress={() => {
          if (online) {
            signaling.send({ type: 'listener.offline' });
            setOnline(false);
          } else {
            goOnline();
          }
        }}
      >
        <Text style={styles.btnText}>{online ? 'GO OFFLINE' : 'GO ONLINE'}</Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error} — ask admin to approve your listener profile</Text>}
      <Text style={styles.section}>This month</Text>
      <Text style={styles.stat}>{earnings?.earned_credits ?? 0} credits earned</Text>
      <Text style={styles.meta}>{earnings?.conversations ?? 0} conversations</Text>
      <Text style={styles.meta}>{earnings?.rating_avg ?? 0} ★</Text>
      <Pressable
        style={styles.ghost}
        onPress={async () => {
          if ((earnings?.earned_credits || 0) > 0) {
            await api('/wallet/payout', {
              method: 'POST',
              body: JSON.stringify({ amount: earnings.earned_credits }),
            });
            setEarnings(await api('/listeners/earnings'));
          }
        }}
      >
        <Text style={styles.link}>Withdraw</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24, paddingTop: 56 },
  center: { justifyContent: 'center', alignItems: 'center' },
  back: { color: '#9ca3af', marginBottom: 24 },
  title: { color: '#f4f1ea', fontSize: 28, fontWeight: '700', marginBottom: 24 },
  sub: { color: '#9ca3af', marginBottom: 24, fontSize: 18 },
  btn: { backgroundColor: '#16a34a', padding: 18, borderRadius: 14, alignItems: 'center' },
  accept: { backgroundColor: '#16a34a', paddingHorizontal: 40, paddingVertical: 18, borderRadius: 14 },
  end: { backgroundColor: '#b91c1c', paddingHorizontal: 40, paddingVertical: 18, borderRadius: 14 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  section: { color: '#9ca3af', marginTop: 40, marginBottom: 8 },
  stat: { color: '#f4f1ea', fontSize: 28, fontWeight: '700' },
  meta: { color: '#9ca3af', marginTop: 4 },
  ghost: { marginTop: 24 },
  ghostText: { color: '#9ca3af' },
  link: { color: '#e85d04' },
  error: { color: '#f87171', marginTop: 16 },
});
