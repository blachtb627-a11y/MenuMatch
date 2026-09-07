import React from 'react';
import { LegalScreen } from '@/components/LegalScreen';
import { TERMS } from '@/content/legal';

export default function TermsScreen() {
  return <LegalScreen doc={TERMS} />;
}
