import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, Screen } from '@/components/ui';
import type { LegalDoc } from '@/content/legal';
import { colors, radius, space, type } from '@/theme';

/** One renderer for all three documents, so they cannot drift apart in look. */
export function LegalScreen({ doc }: { doc: LegalDoc }) {
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* No title in the bar: the document's own heading is the first thing
            under it, and two of the same words in a row reads as a mistake. */}
        <View style={s.bar}>
          <BackButton fallback="/(tabs)/profile" />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.title}>{doc.title}</Text>
          <Text style={s.meta}>
            {doc.effective}
            {doc.readingTime ? `  ·  ${doc.readingTime}` : ''}
          </Text>
          <Text style={s.intro}>{doc.intro}</Text>

          {doc.sections.map((section, i) => (
            <View key={section.heading} style={s.section}>
              <Text style={s.heading}>{`${i + 1}. ${section.heading}`}</Text>
              {section.blocks.map((block, j) => {
                if (block.kind === 'bullets') {
                  return (
                    <View key={j} style={s.bullets}>
                      {block.items.map((item) => (
                        <View key={item} style={s.bulletRow}>
                          <Text style={s.bulletDot}>•</Text>
                          <Text style={s.bulletText}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  );
                }
                if (block.kind === 'callout') {
                  return (
                    <View key={j} style={s.callout}>
                      <Text style={s.calloutText}>{block.text}</Text>
                    </View>
                  );
                }
                return <Text key={j} style={s.para}>{block.text}</Text>;
              })}
            </View>
          ))}

          <Text style={s.footer}>{doc.footer}</Text>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  body: { padding: space.lg, paddingBottom: space.xxxl, gap: space.md },
  title: { ...type.display, color: colors.text },
  meta: { ...type.small, color: colors.textFaint },
  intro: { ...type.body, color: colors.textMuted, lineHeight: 23, marginTop: space.sm },
  section: { gap: space.sm, marginTop: space.lg },
  heading: { ...type.heading, color: colors.text },
  para: { ...type.body, color: colors.textMuted, lineHeight: 23 },
  bullets: { gap: space.sm, marginTop: space.xs },
  bulletRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.sm },
  bulletDot: { ...type.body, color: colors.mint, lineHeight: 23 },
  bulletText: { ...type.body, color: colors.textMuted, lineHeight: 23, flex: 1 },
  callout: {
    backgroundColor: colors.mintWash, borderRadius: radius.md, padding: space.md,
    borderLeftWidth: 3, borderLeftColor: colors.mint, marginTop: space.xs,
  },
  calloutText: { ...type.body, color: colors.text, lineHeight: 22 },
  footer: {
    ...type.small, color: colors.textFaint, lineHeight: 20,
    marginTop: space.xl, borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: space.lg,
  },
});
