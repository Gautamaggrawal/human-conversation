import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { CallFlowScreen } from './src/screens/CallFlowScreen';
import { PostCallScreen } from './src/screens/PostCallScreen';
import { ListenerScreen } from './src/screens/ListenerScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { getToken, clearToken } from './src/api';

type Screen =
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'call'; duration: number; listenerId?: string }
  | {
      name: 'postcall';
      callId?: string;
      listenerId?: string;
      billableSeconds?: number;
    }
  | { name: 'listener' }
  | { name: 'wallet' }
  | { name: 'history' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'login' });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    getToken().then((t) => {
      setScreen(t ? { name: 'home' } : { name: 'login' });
      setBooting(false);
    });
  }, []);

  if (booting) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {screen.name === 'login' && (
        <LoginScreen onLoggedIn={() => setScreen({ name: 'home' })} />
      )}
      {screen.name === 'home' && (
        <HomeScreen
          onTalk={(duration, listenerId) => setScreen({ name: 'call', duration, listenerId })}
          onWallet={() => setScreen({ name: 'wallet' })}
          onListenerMode={() => setScreen({ name: 'listener' })}
          onHistory={() => setScreen({ name: 'history' })}
        />
      )}
      {screen.name === 'call' && (
        <CallFlowScreen
          duration={screen.duration}
          preferListenerId={screen.listenerId}
          onCancel={() => setScreen({ name: 'home' })}
          onDone={(r) =>
            setScreen({
              name: 'postcall',
              callId: r.callId,
              listenerId: r.listenerId || screen.listenerId,
              billableSeconds: r.billableSeconds,
            })
          }
        />
      )}
      {screen.name === 'postcall' && (
        <PostCallScreen
          callId={screen.callId}
          listenerId={screen.listenerId}
          billableSeconds={screen.billableSeconds}
          onDone={() => setScreen({ name: 'home' })}
          onTalkAgain={() =>
            setScreen({ name: 'call', duration: 600, listenerId: screen.listenerId })
          }
        />
      )}
      {screen.name === 'listener' && (
        <ListenerScreen onBack={() => setScreen({ name: 'home' })} />
      )}
      {screen.name === 'wallet' && <WalletScreen onBack={() => setScreen({ name: 'home' })} />}
      {screen.name === 'history' && (
        <HistoryScreen
          onBack={() => setScreen({ name: 'home' })}
          onTalkAgain={(listenerId) => setScreen({ name: 'call', duration: 600, listenerId })}
        />
      )}
    </SafeAreaProvider>
  );
}

// keep clearToken available for future logout UI
void clearToken;
