import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StatusBar,
  Platform,
} from 'react-native';
import { BOOK_TITLE, BOOK_AUTHOR, STORIES } from './book';
import * as Clipboard from 'expo-clipboard';

// Gemini API key (new-style "auth" key, starts with AQ.)
const GEMINI_API_KEY = 'AQ.Ab8RN6L6R6GjZlnTgzb5zOSZXS5Wk2L17IwCW4RakOTABEQX6g';

export default function App() {
  const [currentStoryId, setCurrentStoryId] = useState(1);
  const [showContents, setShowContents] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState(null); // { key, text, x, y }
  const scrollRef = useRef(null);

  const currentStory = STORIES.find((s) => s.id === currentStoryId);

  const selectStory = (id) => {
    setCurrentStoryId(id);
    setShowContents(false);
    // Scroll back to top when switching stories
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ y: 0, animated: false });
    }
  };

  const askAI = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer('');

    try {
      const systemPrompt = `You are a reading companion helping a reader understand "${BOOK_TITLE}" by ${BOOK_AUTHOR}.

The reader is currently reading the story titled "${currentStory.title}".

RULES:
1. Answer in 2-4 sentences maximum.
2. Only discuss things up to and including the story "${currentStory.title}". NEVER reveal events, twists, or endings from this story that the reader may not have reached yet, and never reference later stories in the book.
3. If asked something that would spoil the ending, say: "That would spoil it - keep reading!"
4. Give brief, clear definitions for old-fashioned words, Victorian references, or confusing phrases.
5. You may give a short, relevant example if it helps understanding.
6. Never write long essays or comprehensive analysis. Stay concise and conversational.`;

      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: question }] }],
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'API error');
      }
      const result =
        data.candidates?.[0]?.content?.parts?.[0]?.text || 'No answer received.';
      setAnswer(result);
    } catch (error) {
      setAnswer('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------- TABLE OF CONTENTS VIEW ----------
  if (showContents) {
    return (
      <View style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Contents</Text>
          <TouchableOpacity onPress={() => setShowContents(false)}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.tocList}>
          <Text style={styles.tocBookTitle}>{BOOK_TITLE}</Text>
          <Text style={styles.tocBookAuthor}>{BOOK_AUTHOR}</Text>
          {STORIES.map((story) => (
            <TouchableOpacity
              key={story.id}
              style={[
                styles.tocItem,
                story.id === currentStoryId && styles.tocItemActive,
              ]}
              onPress={() => selectStory(story.id)}
            >
              <Text
                style={[
                  styles.tocItemText,
                  story.id === currentStoryId && styles.tocItemTextActive,
                ]}
              >
                {story.id}. {story.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ---------- READER VIEW (AI panel is an overlay within it) ----------

  // ---------- READER VIEW ----------
  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowContents(true)}>
          <Text style={styles.menuButton}>☰</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentStory.title}
          </Text>
        </View>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView ref={scrollRef} style={styles.bookContainer}>
        <Text style={styles.storyTitle}>{currentStory.title}</Text>
        {currentStory.content
          .split(/\n\s*\n/)
          .map((para) => para.replace(/\n/g, ' ').trim())
          .filter((para) => para.length > 0)
          .map((para, pIndex) => {
            // Split paragraph into sentences (keep the punctuation)
            const sentences = para.match(/[^.!?]+[.!?]*["”']*\s*/g) || [para];
            return (
              <View key={pIndex} style={styles.paragraph}>
                <Text style={styles.bookText}>
                  {sentences.map((sentence, sIndex) => {
                    const key = pIndex + '-' + sIndex;
                    const isSelected = selection && selection.key === key;
                    return (
                      <Text
                        key={key}
                        onPress={(e) => {
                          const { pageX, pageY } = e.nativeEvent;
                          setSelection({
                            key,
                            text: sentence.trim(),
                            x: pageX,
                            y: pageY,
                          });
                        }}
                        suppressHighlighting={true}
                        style={isSelected ? styles.sentenceSelected : null}
                      >
                        {sentence}
                      </Text>
                    );
                  })}
                </Text>
              </View>
            );
          })}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Tap-anywhere backdrop to dismiss the selection */}
      {selection && (
        <TouchableOpacity
          style={styles.dismissBackdrop}
          activeOpacity={1}
          onPress={() => setSelection(null)}
        />
      )}

      {/* Floating selection popup, positioned just above the tapped sentence */}
      {selection && (
        <View
          style={[
            styles.popup,
            {
              top: Math.max(60, selection.y - 60),
              left: Math.min(Math.max(12, selection.x - 90), 220),
            },
          ]}
        >
          <TouchableOpacity
            style={styles.popupBtn}
            onPress={() => {
              setAnswer('');
              setQuestion('What does this mean?\n\n"' + selection.text + '"');
              setSelection(null);
              setShowAiPanel(true);
            }}
          >
            <Text style={styles.popupBtnText}>💬 Ask</Text>
          </TouchableOpacity>
          <View style={styles.popupDivider} />
          <TouchableOpacity
            style={styles.popupBtn}
            onPress={async () => {
              await Clipboard.setStringAsync(selection.text);
              setSelection(null);
            }}
          >
            <Text style={styles.popupBtnText}>Copy</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => {
          setAnswer('');
          setQuestion('');
          setShowAiPanel(true);
        }}
      >
        <Text style={styles.buttonEmoji}>💬</Text>
      </TouchableOpacity>

      {/* AI panel as an overlay — reader stays mounted underneath, keeping scroll position */}
      {showAiPanel && (
        <View style={styles.aiOverlay}>
          <View style={styles.aiHeaderBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Ask Lumina</Text>
              <Text style={styles.headerSubtitle}>{currentStory.title}</Text>
            </View>
            <TouchableOpacity
              style={styles.aiCloseHit}
              onPress={() => setShowAiPanel(false)}
            >
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.aiContent}>
            <TextInput
              style={styles.questionInput}
              placeholder="Ask about a word, character, or what's happening..."
              placeholderTextColor="#999"
              value={question}
              onChangeText={setQuestion}
              multiline
            />
            <TouchableOpacity
              style={[styles.askButton, loading && styles.askButtonDisabled]}
              onPress={askAI}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.askButtonText}>Ask</Text>
              )}
            </TouchableOpacity>

            <ScrollView style={styles.answerContainer}>
              {answer ? (
                <Text style={styles.answerText} selectable>
                  {answer}
                </Text>
              ) : (
                <Text style={styles.answerPlaceholder}>
                  Long-press a sentence in the book to ask about it, or type your
                  own question above.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fdfcf9' },
  safeArea: {
    flex: 1,
    backgroundColor: '#fdfcf9',
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e4da',
    backgroundColor: '#fdfcf9',
  },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  menuButton: { fontSize: 22, color: '#333' },
  closeButton: { fontSize: 20, color: '#666' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  headerSubtitle: { fontSize: 11, color: '#999', marginTop: 2 },

  // Reader
  bookContainer: { flex: 1, paddingHorizontal: 22, paddingTop: 16 },
  storyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
    fontFamily: 'Georgia',
  },
  paragraph: {
    marginBottom: 18,
  },
  bookText: {
    fontSize: 18,
    lineHeight: 30,
    color: '#2b2b2b',
    fontFamily: 'Georgia',
  },
  sentenceSelected: {
    backgroundColor: '#ece3ff',
    color: '#4c1d95',
  },
  popup: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 20,
  },
  dismissBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  popupBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  popupBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  popupDivider: {
    width: 1,
    backgroundColor: '#444',
    marginVertical: 6,
  },

  // Floating button
  floatingButton: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonEmoji: { fontSize: 26 },

  // Table of contents
  tocList: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  tocBookTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    fontFamily: 'Georgia',
  },
  tocBookAuthor: { fontSize: 13, color: '#888', marginBottom: 20, marginTop: 4 },
  tocItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tocItemActive: {},
  tocItemText: { fontSize: 16, color: '#333', fontFamily: 'Georgia' },
  tocItemTextActive: { color: '#7c3aed', fontWeight: '700' },

  // AI panel
  // AI panel
  aiOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fdfcf9',
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    zIndex: 50,
  },
  aiHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e4da',
  },
  aiCloseHit: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: -8,
  },
  aiContent: { flex: 1, padding: 16 },
  questionInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    minHeight: 90,
    marginBottom: 12,
    textAlignVertical: 'top',
    color: '#1a1a1a',
    backgroundColor: '#fff',
  },
  askButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  askButtonDisabled: { backgroundColor: '#b9a3e0' },
  askButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  answerContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
  },
  answerText: { fontSize: 16, lineHeight: 24, color: '#2b2b2b' },
  answerPlaceholder: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
});
