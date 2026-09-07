import React from 'react';
import { LegalScreen } from '@/components/LegalScreen';
import { PRIVACY } from '@/content/legal';

export default function PrivacyScreen() {
  return <LegalScreen doc={PRIVACY} />;
}
