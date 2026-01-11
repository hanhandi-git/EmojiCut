const getApiKey = (passedKey?: string): string | null => {
  return passedKey || process.env.API_KEY || (typeof window !== 'undefined' ? localStorage.getItem('apimart_api_key') : null);
};

// ==================== Prompt Templates ====================

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  basePrompt: string;
  styleDescription: string;
}

let promptTemplatesCache: PromptTemplate[] | null = null;

/**
 * Load prompt templates from JSON file
 */
export const loadPromptTemplates = async (): Promise<PromptTemplate[]> => {
  if (promptTemplatesCache) {
    return promptTemplatesCache;
  }

  try {
    const response = await fetch('/promptTemplates.json');
    if (!response.ok) {
      throw new Error(`Failed to load templates: ${response.status}`);
    }
    const data = await response.json();
    promptTemplatesCache = data.templates || [];
    return promptTemplatesCache;
  } catch (error) {
    console.error('Failed to load prompt templates:', error);
    // Return default template if loading fails
    return [{
      id: 'cute_line',
      name: '可爱 LINE 风格',
      description: '经典 LINE 贴纸风格，简洁可爱',
      basePrompt: `Create LINE-style stickers based on the character in the image. Design should be clean, minimal, and charming with soft colors. Character in chibi (two-head) proportion.

REQUIREMENTS:
- Pure white background (#FFFFFF) only
- Each sticker with distinct pose and expression
- Clear spacing between stickers (minimum 20px)
- Arrange in a clean grid layout`,
      styleDescription: 'Cute LINE sticker style with soft pastel colors and simple, expressive designs'
    }];
  }
};

/**
 * Get a prompt template by ID
 */
export const getPromptTemplate = async (templateId: string): Promise<PromptTemplate | null> => {
  const templates = await loadPromptTemplates();
  return templates.find(t => t.id === templateId) || null;
};

// ==================== AI Logic ====================

/**
 * Build the generation prompt with template + user-defined style + language + count
 * If templateId is provided, use the template; otherwise use default
 * If user provides a custom style, it takes priority over the template's style
 */
export const buildStickerPrompt = async (
  templateId?: string,
  manualStyle?: string,
  language: 'zh' | 'en' | 'ja' = 'zh',
  stickerCount: number = 16
): Promise<string> => {
  let basePrompt: string;
  let defaultStyleDescription: string;

  if (templateId) {
    const template = await getPromptTemplate(templateId);
    if (template) {
      basePrompt = template.basePrompt;
      defaultStyleDescription = template.styleDescription;
    } else {
      // Fallback to default if template not found
      const templates = await loadPromptTemplates();
      const defaultTemplate = templates[0];
      basePrompt = defaultTemplate.basePrompt;
      defaultStyleDescription = defaultTemplate.styleDescription;
    }
  } else {
    // Use default template
    const templates = await loadPromptTemplates();
    const defaultTemplate = templates[0];
    basePrompt = defaultTemplate.basePrompt;
    defaultStyleDescription = defaultTemplate.styleDescription;
  }

  const styleDescription = manualStyle && manualStyle.trim()
    ? manualStyle.trim()
    : defaultStyleDescription;

  // Language-specific text requirements
  let languageRequirement = '';
  let textExamples = '';
  
  switch (language) {
    case 'zh':
      languageRequirement = 'All text must be in Simplified Chinese (简体中文). Use proper Chinese fonts (Microsoft YaHei, SimHei, PingFang SC, or similar standard fonts). Text must be CLEAR and READABLE - NO garbled characters, NO corrupted text, NO missing strokes. Each Chinese character must be fully rendered with correct glyphs.';
      textExamples = 'Include appropriate Chinese dialogue or expressions (like "好的", "谢谢", "加油", "哈哈" etc.) that match each sticker\'s emotion/scenario';
      break;
    case 'en':
      languageRequirement = 'All text must be in English. Use clear, readable English fonts. Text must be properly spaced and aligned.';
      textExamples = 'Include appropriate English dialogue or expressions (like "OK", "Thanks", "Good luck", "Haha" etc.) that match each sticker\'s emotion/scenario';
      break;
    case 'ja':
      languageRequirement = 'All text must be in Japanese (日本語). Use proper Japanese fonts (Hiragino Sans, Noto Sans JP, or similar standard fonts). Text must be CLEAR and READABLE - NO garbled characters, NO corrupted text. Each Japanese character (hiragana, katakana, kanji) must be fully rendered with correct glyphs.';
      textExamples = 'Include appropriate Japanese dialogue or expressions (like "はい", "ありがとう", "頑張って", "ははは" etc.) that match each sticker\'s emotion/scenario';
      break;
  }

  // Build the final prompt by appending language and count requirements
  // The base prompt from template is already clean and doesn't include language/count
  const finalPrompt = `${basePrompt}

TEXT REQUIREMENTS:
- ${languageRequirement}
- ${textExamples}

QUANTITY:
- Generate exactly ${stickerCount} stickers in total
- Each sticker must be unique with different poses, expressions, and scenarios

STYLE: ${styleDescription}

⚠️ CRITICAL: Ensure all text characters are rendered correctly and are fully readable. Do NOT generate garbled or corrupted text.`;

  return finalPrompt;
};

/**
 * Query task status from Apimart.ai API
 */
const getTaskStatus = async (taskId: string, apiKey: string): Promise<any> => {
  const response = await fetch(`https://api.apimart.ai/v1/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Task status query failed: ${response.status} ${errorText}`);
  }

  return await response.json();
};

/**
 * Poll task status until completion
 */
const pollTaskUntilComplete = async (
  taskId: string,
  apiKey: string,
  onProgress?: (message: string) => void,
  maxAttempts: number = 60,
  intervalMs: number = 2000
): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusData = await getTaskStatus(taskId, apiKey);

    // Check if task is complete
    if (statusData.code === 200 && statusData.data) {
      const task = statusData.data;
      
      // Update progress if available
      if (onProgress && task.progress !== undefined) {
        onProgress(`生成中... ${task.progress}%`);
      } else if (onProgress) {
        onProgress(`生成中... (${attempt + 1}/${maxAttempts})`);
      }
      
      if (task.status === 'completed') {
        // Extract image URL from completed task
        // Format: result.images[0].url[0]
        if (task.result && task.result.images && task.result.images[0]) {
          const imageData = task.result.images[0];
          const imageUrl = Array.isArray(imageData.url) 
            ? imageData.url[0] 
            : imageData.url;
          
          if (imageUrl) {
            if (onProgress) {
              onProgress('下载生成的图片...');
            }
            
            // Fetch the image and convert to data URL
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
              throw new Error(`Failed to fetch image: ${imageResponse.status}`);
            }
            
            const blob = await imageResponse.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        }
        
        throw new Error("Task completed but no image URL found in response");
      } else if (task.status === 'failed' || task.status === 'error') {
        throw new Error(`Task failed: ${task.error || task.message || 'Unknown error'}`);
      }
      // If status is 'submitted' or 'processing', continue polling
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Task timeout after ${maxAttempts} attempts`);
};

/**
 * Generate a sticker sheet using Apimart.ai API (async mode)
 */
export const generateStickerSheet = async (
  referenceImage: string,
  templateId?: string,
  manualStyle?: string,
  language: 'zh' | 'en' | 'ja' = 'zh',
  stickerCount: number = 16,
  model: string = 'gemini-2.5-flash-image-preview',
  userApiKey?: string,
  onProgress?: (message: string) => void
): Promise<string> => {
  const apiKey = getApiKey(userApiKey);
  if (!apiKey) throw new Error("API_KEY is not set");

  try {
    const prompt = await buildStickerPrompt(templateId, manualStyle, language, stickerCount);

    // Use the full data URL format as specified in the documentation
    // Documentation says: data:image/{格式};base64,{base64数据}
    const imageUrl = referenceImage.startsWith('data:') 
      ? referenceImage 
      : `data:image/png;base64,${referenceImage}`;

    if (onProgress) {
      onProgress('提交生成任务...');
    }

    // Step 1: Submit the generation task
    const response = await fetch('https://api.apimart.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        size: '1:1',
        n: 1,
        image_urls: [imageUrl]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Step 2: Extract task_id from response
    if (data.code === 200 && data.data && data.data[0] && data.data[0].task_id) {
      const taskId = data.data[0].task_id;
      
      // Step 3: Poll task status until completion
      return await pollTaskUntilComplete(taskId, apiKey, onProgress);
    }

    throw new Error("No task_id returned from API. Response: " + JSON.stringify(data));

  } catch (error) {
    console.error("Sticker Generation Error:", error);
    throw error;
  }
};

// ==================== Sticker Naming ====================

export const generateStickerName = async (base64Image: string, userApiKey?: string): Promise<string> => {
  const apiKey = getApiKey(userApiKey);
  if (!apiKey) return "sticker";

  try {
    // Use Apimart.ai chat completion API for naming
    // Convert base64 image to data URL if needed
    const imageUrl = base64Image.startsWith('data:') 
      ? base64Image 
      : `data:image/png;base64,${base64Image}`;

    const response = await fetch('https://api.apimart.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              },
              {
                type: 'text',
                text: "Analyze this sticker. Return a JSON object with a 'filename' property containing a short, descriptive name (max 3 words) in English using snake_case. If there is text, try to capture the meaning or emotion. Example: 'sad_crying', 'thumbs_up', 'working_hard'."
              }
            ]
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      const content = JSON.parse(data.choices[0].message.content);
      return content.filename || "sticker";
    }
    
    return "sticker";

  } catch (error) {
    console.error("Naming Error:", error);
    return "sticker"; // Fallback
  }
};
