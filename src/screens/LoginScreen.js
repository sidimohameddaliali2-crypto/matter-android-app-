import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import MatterLogo from '../components/MatterLogo';
import { colors } from '../theme/matterTheme';

const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
    } catch (error) {
      Alert.alert(
        'Login Failed',
        error.response?.data?.message || 'Invalid credentials'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <LinearGradient
        colors={[colors.bg, colors.bgAlt]}
        className="flex-1 justify-center px-8"
      >
        <View className="items-center mb-9">
          <MatterLogo size={46} />
          <Text className="mt-2 text-sm text-matterMuted tracking-[2px] uppercase">Driver Portal</Text>
        </View>

        <View className="w-full">
          <Text className="text-xs uppercase tracking-[1px] text-matterMuted mb-1.5">Email</Text>
          <TextInput
            className="bg-matterBgAlt border border-matterBorder rounded-2xl px-4 h-14 text-base text-matterText mb-3"
            placeholder="driver@matter.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor="rgba(168,204,245,0.55)"
          />

          <Text className="text-xs uppercase tracking-[1px] text-matterMuted mb-1.5 mt-1">Password</Text>
          <TextInput
            className="bg-matterBgAlt border border-matterBorder rounded-2xl px-4 h-14 text-base text-matterText"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor="rgba(168,204,245,0.55)"
          />

          <TouchableOpacity
            className={`rounded-full h-14 items-center justify-center mt-7 ${loading ? 'bg-matterLime/50' : 'bg-matterLime'}`}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text className="text-matterBgAlt text-lg font-bold">
              {loading ? 'Signing in...' : 'Sign in'}
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};
export default LoginScreen;
