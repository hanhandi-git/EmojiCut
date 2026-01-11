const getApiKey = (passedKey?: string): string | null => {
  return passedKey || process.env.API_KEY || (typeof window !== 'undefined' ? localStorage.getItem('apimart_api_key') : null);
};

// ==================== AI Logic ====================

/**
 * Build the generation prompt with base template + user-defined style
 * If user provides a custom style, it takes priority over the preset style
 */
const buildStickerPrompt = (manualStyle?: string): string => {
  const basePrompt = `Create 16 cute LINE-style stickers based on the character in the image. Each sticker should have creative poses and text layouts, with diverse designs. The character should be in a chibi (two-head) style.

CRITICAL REQUIREMENTS:
1. Background: Pure white (#FFFFFF) only, no other colors or patterns
2. Chinese Text: All text must be in Simplified Chinese (简体中文)
   - Use proper Chinese fonts (Microsoft YaHei, SimHei, PingFang SC, or similar standard fonts)
   - Text must be CLEAR and READABLE - NO garbled characters, NO corrupted text, NO missing strokes
   - Each Chinese character must be fully rendered with correct glyphs
   - Text should be properly spaced and aligned
3. Text Content: Include appropriate Chinese dialogue or expressions (like "好的", "谢谢", "加油", "哈哈" etc.) that match each sticker's emotion/scenario
4. Layout: Each sticker should have sufficient spacing between them (at least 20px gap)
5. Character: Show the character in different scenarios and emotions

The stickers should be arranged in a grid layout with clear separation.`;

  const styleDescription = manualStyle && manualStyle.trim()
    ? manualStyle.trim()
    : "Cute chibi character style, suitable for daily chat";

  return `${basePrompt}\n\nStyle: ${styleDescription}\n\n⚠️ CRITICAL: Ensure all Chinese characters are rendered correctly. Test that text like "你好" "谢谢" "好的" appears clearly and is fully readable. Do NOT generate garbled or corrupted Chinese text.`;
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
  manualStyle?: string,
  userApiKey?: string,
  onProgress?: (message: string) => void
): Promise<string> => {
  const apiKey = getApiKey(userApiKey);
  if (!apiKey) throw new Error("API_KEY is not set");

  try {
    const prompt = buildStickerPrompt(manualStyle);

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
        model: 'gemini-2.5-flash-image-preview',
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
