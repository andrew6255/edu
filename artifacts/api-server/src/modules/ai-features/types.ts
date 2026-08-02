export type AiFeatureTask =
  | 'test_generation'
  | 'test_grading'
  | 'feynman_format'
  | 'feynman_feedback'
  | 'study_sheet'
  | 'subject_emoji'
  | 'question_enrichment'
  | 'question_classification';

export type AiFeatureContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type AiFeatureMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | AiFeatureContentPart[];
};

export type AiFeatureRequest = {
  task: AiFeatureTask;
  messages: AiFeatureMessage[];
};

export type AiFeatureResult = {
  content: string;
  model: string;
};
