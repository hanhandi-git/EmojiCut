import React, { useRef, useState, useEffect } from 'react';
import '../shojo.css';
import { Sparkles, Heart, Star, CloudUpload, Power, Scissors, Wand2, Image as ImageIcon, HelpCircle, X, Loader2, Copy, Download, ZoomIn } from 'lucide-react';
import { generateStickerSheet, loadPromptTemplates, PromptTemplate, buildStickerPrompt } from '../services/geminiService';
import { loadImage, processStickerSheet } from '../services/imageProcessor';
import JSZip from 'jszip';

interface CutePrinterProps {
    status: 'idle' | 'uploading' | 'generating' | 'processing' | 'complete' | 'error';
    progress?: number;
    message?: string;
    onGenerated: (imageDataUrl: string) => void;
    onDirectUpload: (file: File) => void;
    apiKey: string;
    onApiKeyChange: (newKey: string) => void;
}

const CutePrinter2D: React.FC<CutePrinterProps> = ({ status, progress, message, onGenerated, onDirectUpload, apiKey, onApiKeyChange }) => {
    const charInputRef = useRef<HTMLInputElement>(null);
    const sheetInputRef = useRef<HTMLInputElement>(null);
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    const [customStyle, setCustomStyle] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState<'zh' | 'en' | 'ja'>('zh');
    const [stickerCount, setStickerCount] = useState<number>(16);
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash-image-preview');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showInstructions, setShowInstructions] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [showKeySaved, setShowKeySaved] = useState(false);
    const [activeMode, setActiveMode] = useState<'generate' | 'direct'>(apiKey ? 'generate' : 'direct');
    const [showKeyError, setShowKeyError] = useState(false);
    const [currentPrompt, setCurrentPrompt] = useState<string>('');
    const [promptCopied, setPromptCopied] = useState(false);
    const [generatedStickers, setGeneratedStickers] = useState<Array<{ id: string; dataUrl: string; index: number }>>([]);
    const [viewingImage, setViewingImage] = useState<string | null>(null);
    const [isZipping, setIsZipping] = useState(false);

    // Load templates on mount
    useEffect(() => {
        loadPromptTemplates().then(loadedTemplates => {
            setTemplates(loadedTemplates);
            if (loadedTemplates.length > 0) {
                setSelectedTemplateId(loadedTemplates[0].id);
            }
        });
    }, []);

    // Update prompt preview when settings change
    // Keep prompt visible even after generation completes
    useEffect(() => {
        if (referenceImage && selectedTemplateId) {
            buildStickerPrompt(
                selectedTemplateId,
                customStyle || undefined,
                selectedLanguage,
                stickerCount
            ).then(prompt => {
                setCurrentPrompt(prompt);
            }).catch(() => {
                // Keep existing prompt if build fails
            });
        }
        // Don't clear prompt when referenceImage is removed, keep it for reference
    }, [referenceImage, selectedTemplateId, customStyle, selectedLanguage, stickerCount]);

    const copyToClipboard = (text: string) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    setPromptCopied(true);
                    setTimeout(() => setPromptCopied(false), 2000);
                })
                .catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    };

    const fallbackCopy = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch (err) {
            alert("复制失败，请手动选择复制。");
        }
        document.body.removeChild(textArea);
    };

    const copyPrompt = () => {
        if (currentPrompt) {
            copyToClipboard(currentPrompt);
        }
    };


    const handlePanelClick = () => {
        if (status === 'idle' || status === 'complete') {
            if (activeMode === 'generate') {
                charInputRef.current?.click();
            } else {
                sheetInputRef.current?.click();
            }
        }
    };

    const processImageFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            setReferenceImage(event.target?.result as string);
            setError(null);
        };
        reader.readAsDataURL(file);
    };

    const handleCharFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processImageFile(e.target.files[0]);
        }
    };

    const handleSheetFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onDirectUpload(e.target.files[0]);
        }
    };

    // --- Drag & Drop Handlers ---
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = () => {
        setIsDragging(false);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (activeMode === 'generate') {
                processImageFile(file);
            } else {
                onDirectUpload(file);
            }
        }
    };

    // --- Paste Event Support ---
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        const file = items[i].getAsFile();
                        if (file) {
                            if (activeMode === 'generate') {
                                processImageFile(file);
                            } else {
                                onDirectUpload(file);
                            }
                        }
                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    const handleGenerate = async () => {
        if (!referenceImage) return;

        setIsGenerating(true);
        setError(null);

        try {
            const generatedImageUrl = await generateStickerSheet(
                referenceImage,
                selectedTemplateId || undefined,
                customStyle || undefined,
                selectedLanguage,
                stickerCount,
                selectedModel,
                apiKey,
                (msg) => {
                    // Update progress message if needed
                    console.log('Generation progress:', msg);
                }
            );
            
            // Process the generated image to extract individual stickers
            try {
                const response = await fetch(generatedImageUrl);
                const blob = await response.blob();
                const file = new File([blob], 'generated_stickers.png', { type: 'image/png' });
                const img = await loadImage(file);
                
                const detectedSegments = await processStickerSheet(img, (msg) => {
                    console.log('Processing:', msg);
                });
                
                // Store stickers with index for ordering
                const stickers = detectedSegments.map((seg, idx) => ({
                    id: seg.id,
                    dataUrl: seg.dataUrl,
                    index: idx
                }));
                
                setGeneratedStickers(stickers);
                // Don't call onGenerated if we successfully processed stickers
                // Keep the component in generate mode to show the stickers
                return;
            } catch (processErr) {
                console.error('Failed to process stickers:', processErr);
                // If processing fails, call onGenerated to switch to cut mode
            }
            
            // Only call onGenerated if processing failed or if no stickers were generated
            onGenerated(generatedImageUrl);
        } catch (err) {
            console.error('Generation failed:', err);
            setError(err instanceof Error ? err.message : '生成失败，请重试');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReset = () => {
        setReferenceImage(null);
        setCustomStyle('');
        setError(null);
        setGeneratedStickers([]);
        setViewingImage(null);
        setCurrentPrompt(''); // Clear prompt only on reset
    };

    const handleImageClick = (dataUrl: string) => {
        setViewingImage(dataUrl);
    };

    const handleCopyImage = async (dataUrl: string) => {
        try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy image:', err);
            alert('复制失败，请重试');
        }
    };

    const handleDownloadImage = (dataUrl: string, index: number) => {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `sticker_${index + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadAll = async () => {
        if (generatedStickers.length === 0) return;
        
        setIsZipping(true);
        try {
            const zip = new JSZip();
            
            // Sort stickers by index to ensure correct order
            const sortedStickers = [...generatedStickers].sort((a, b) => a.index - b.index);
            
            sortedStickers.forEach((sticker, idx) => {
                // Extract base64 data from data URL
                const base64Data = sticker.dataUrl.split(',')[1];
                zip.file(`sticker_${idx + 1}.png`, base64Data, { base64: true });
            });
            
            const content = await zip.generateAsync({ type: "blob" });
            
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = `stickers_${new Date().getTime()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error zipping:", error);
            alert("打包失败，请重试");
        } finally {
            setIsZipping(false);
        }
    };

    const currentStatus = isGenerating ? 'generating' : status;

    return (
        <div className="flex gap-4 w-full max-w-7xl mx-auto px-4">
            {/* Left Sidebar - Prompt Preview */}
            <div className="w-80 flex-shrink-0">
                <div className="bg-white rounded-2xl border-4 border-pink-200 shadow-lg p-4 sticky top-4 max-h-[calc(100vh-2rem)] flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-pink-600 flex items-center gap-2">
                            <Sparkles size={16} />
                            最终 Prompt
                        </h3>
                        {currentPrompt && (
                            <button
                                onClick={copyPrompt}
                                className={`cute-select-btn px-3 py-1.5 rounded-lg border-2 text-xs transition-all ${
                                    promptCopied
                                        ? 'bg-green-100 border-green-400 text-green-600'
                                        : 'bg-white border-pink-200 text-pink-400 hover:border-pink-300'
                                }`}
                            >
                                {promptCopied ? '✓ 已复制' : '📋 复制'}
                            </button>
                        )}
                    </div>
                    <div className="flex-1 overflow-auto">
                        {currentPrompt ? (
                            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-pink-50 p-3 rounded-lg border border-pink-100 leading-relaxed">
                                {currentPrompt}
                            </pre>
                        ) : (
                            <div className="text-xs text-gray-400 text-center py-8">
                                上传图片并选择设置后<br />将显示生成的 Prompt
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right Side - Main Printer and Generated Images */}
            <div className="flex-1 flex flex-col gap-4">
                {/* Main Printer */}
                <div
                    className={`cute-machine cute-machine-expanded ${currentStatus === 'generating' || currentStatus === 'processing' ? 'processing' : ''} ${isDragging ? 'dragging' : ''}`}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                >
            {isDragging && (
                <div className="drag-overlay">
                    <CloudUpload size={48} className="animate-bounce" />
                    <span>放开以投喂图片 ✨</span>
                </div>
            )}

            {/* Decorative Floating Icons */}
            <div className="deco deco-star" style={{ top: -20, left: -20 }}><Star fill="currentColor" /></div>
            <div className="deco deco-heart" style={{ top: 20, right: -30 }}><Heart fill="currentColor" /></div>
            <div className="deco deco-star" style={{ bottom: -10, left: -10, fontSize: '18px' }}><Star fill="currentColor" /></div>

            {/* Printer Brand / Header */}
            <div className="w-full flex justify-center items-center gap-2 mb-2 opacity-80">
                <div className="w-2 h-2 rounded-full bg-pink-400"></div>
                <div className="text-pink-400 font-bold tracking-widest text-xs">✨ NANO BANANA PRO ✨</div>
                <div className="w-2 h-2 rounded-full bg-pink-400"></div>
            </div>

            {/* Screen Area - Upload or Preview */}
            <div className={`machine-screen machine-screen-tall ${activeMode === 'direct' ? 'mode-direct' : ''}`} onClick={!referenceImage ? handlePanelClick : undefined}>
                {!referenceImage ? (
                    activeMode === 'generate' ? (
                        <>
                            <CloudUpload size={36} className="text-pink-400 mb-2 opacity-60" />
                            <div className="screen-text">上传角色图片<br /><span style={{ fontSize: '0.8rem', opacity: 0.7 }}>AI设计表情包</span></div>
                        </>
                    ) : (
                        <>
                            <Scissors size={36} className="text-blue-400 mb-2 opacity-60" />
                            <div className="screen-text text-blue-500">上传表情大图<br /><span style={{ fontSize: '0.8rem', opacity: 0.7 }}>直接切割 (任意规格)</span></div>
                        </>
                    )
                ) : (
                    <div className="relative w-full h-full">
                        <img src={referenceImage} alt="Reference" className="w-full h-full object-contain rounded-2xl" />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleReset(); }}
                            className="absolute top-2 right-2 w-6 h-6 bg-red-400 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-500"
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>

            {/* Style Input Section - Shows after upload */}
            {referenceImage && !isGenerating && currentStatus !== 'processing' && (
                <div className="w-full mt-3 px-2 space-y-3">
                    {/* Model Selection */}
                    <div className="w-full">
                        <label className="block text-xs text-pink-600 mb-2 font-medium">生成模型</label>
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash', desc: '快速生成' },
                                { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro', desc: '高质量' }
                            ].map(model => (
                                <button
                                    key={model.id}
                                    type="button"
                                    onClick={() => setSelectedModel(model.id)}
                                    className={`cute-select-btn px-4 py-2 rounded-xl border-2 transition-all ${
                                        selectedModel === model.id
                                            ? 'bg-pink-100 border-pink-400 text-pink-600 shadow-sm'
                                            : 'bg-white border-pink-200 text-pink-400 hover:border-pink-300'
                                    }`}
                                >
                                    <div className="text-sm font-semibold">{model.name}</div>
                                    <div className="text-[10px] opacity-75">{model.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sticker Count Selection */}
                    <div className="w-full">
                        <label className="block text-xs text-pink-600 mb-2 font-medium">贴纸数量</label>
                        <div className="flex gap-2 flex-wrap">
                            {[4, 8, 12, 16, 20, 24].map(count => (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => setStickerCount(count)}
                                    className={`cute-select-btn px-4 py-2 rounded-xl border-2 transition-all ${
                                        stickerCount === count
                                            ? 'bg-pink-100 border-pink-400 text-pink-600 shadow-sm'
                                            : 'bg-white border-pink-200 text-pink-400 hover:border-pink-300'
                                    }`}
                                >
                                    <span className="text-sm font-semibold">{count} 张</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Language Selection */}
                    <div className="w-full">
                        <label className="block text-xs text-pink-600 mb-2 font-medium">表情包语言</label>
                        <div className="flex gap-2">
                            {[
                                { code: 'zh', label: '中文', emoji: '🇨🇳' },
                                { code: 'en', label: 'English', emoji: '🇺🇸' },
                                { code: 'ja', label: '日本語', emoji: '🇯🇵' }
                            ].map(lang => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    onClick={() => setSelectedLanguage(lang.code as 'zh' | 'en' | 'ja')}
                                    className={`cute-select-btn flex-1 px-3 py-2 rounded-xl border-2 transition-all ${
                                        selectedLanguage === lang.code
                                            ? 'bg-pink-100 border-pink-400 text-pink-600 shadow-sm'
                                            : 'bg-white border-pink-200 text-pink-400 hover:border-pink-300'
                                    }`}
                                >
                                    <span className="text-sm font-medium">{lang.emoji} {lang.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Template Selection */}
                    {templates.length > 0 && (
                        <div className="w-full">
                            <label className="block text-xs text-pink-600 mb-2 font-medium">选择风格模板</label>
                            <div className="grid grid-cols-2 gap-2">
                                {templates.map(template => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        onClick={() => setSelectedTemplateId(template.id)}
                                        className={`cute-select-btn px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
                                            selectedTemplateId === template.id
                                                ? 'bg-pink-100 border-pink-400 text-pink-600 shadow-sm'
                                                : 'bg-white border-pink-200 text-pink-400 hover:border-pink-300'
                                        }`}
                                    >
                                        <div className="font-semibold text-xs mb-0.5">{template.name}</div>
                                        <div className="text-[10px] opacity-75">{template.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* Custom Style Input */}
                    <div className="w-full">
                        <label className="block text-xs text-pink-600 mb-1 font-medium">自定义风格（可选，会覆盖模板风格）</label>
                        <textarea
                            className="printer-style-input"
                            placeholder="输入画面风格，如：赛博朋克、水彩风... (不填则使用模板默认风格)"
                            value={customStyle}
                            onChange={(e) => setCustomStyle(e.target.value)}
                            rows={2}
                        />
                    </div>
                </div>
            )}

            {/* Processing State */}
            {(isGenerating || currentStatus === 'processing') && (
                <div className="w-full mt-3 flex flex-col items-center">
                    <Sparkles size={24} className="text-pink-400 animate-spin mb-2" />
                    <div className="screen-text text-sm mb-2">{message || (isGenerating ? 'AI 生成中...' : 'Processing...')}</div>
                    <div className="w-full max-w-[160px] h-3 bg-white rounded-full border-2 border-pink-200 overflow-hidden">
                        <div
                            className="h-full bg-pink-300 transition-all duration-300"
                            style={{ width: `${progress || (isGenerating ? 50 : 0)}%`, backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.5) 5px, rgba(255,255,255,0.5) 10px)' }}
                        ></div>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="w-full mt-2 px-2">
                    <div className="text-red-400 text-xs text-center bg-red-50 rounded-lg py-2 px-3">
                        {error}
                    </div>
                </div>
            )}

            {/* Physical Controls */}
            <div className="flex items-center justify-center gap-7 w-full px-2 mt-6 pb-4">
                {/* Power / Status Indicator / AI Mode Toggle */}
                <div
                    className="flex flex-col items-center gap-2 cursor-pointer group"
                    onClick={() => {
                        if (!apiKey.trim()) {
                            setError('请先设置 API Key 以使用 AI 设计功能');
                            setShowInstructions(true);
                            setShowKeyError(true);
                            setTimeout(() => setShowKeyError(false), 2000);
                            return;
                        }
                        setActiveMode('generate');
                    }}
                >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-b-4 transition-all shadow-sm active:translate-y-0.5 ${activeMode === 'generate' ? 'bg-pink-100 border-pink-300 text-pink-500' : 'bg-pink-50 border-pink-100 text-pink-200 group-hover:text-pink-300'}`}>
                        <Heart size={22} fill={activeMode === 'generate' ? "currentColor" : "none"} />
                    </div>
                    <div className={`w-2 h-2 rounded-full ${activeMode === 'generate' ? (isGenerating ? 'bg-green-400 animate-pulse' : 'bg-pink-400') : 'bg-pink-100'}`}></div>
                    <div className={`text-[10px] font-bold tracking-tighter uppercase ${activeMode === 'generate' ? 'text-pink-400' : 'text-pink-200'}`}>AI DESIGN</div>
                </div>

                {/* Generate Button - Main AI Action */}
                <button
                    className="printer-action-btn flex items-center justify-center gap-2 px-6 h-12 rounded-full bg-pink-400 text-white font-bold border-b-4 border-pink-600 hover:bg-pink-500 transition-all active:translate-y-1 active:border-b-0 disabled:opacity-50 disabled:translate-y-0 disabled:border-b-4"
                    onClick={handleGenerate}
                    disabled={!referenceImage || isGenerating || activeMode !== 'generate' || !apiKey.trim()}
                >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                    <span>{isGenerating ? '设计中' : '生成贴纸'}</span>
                </button>

                {/* Cutter Button - Direct Mode Toggle */}
                <div
                    className="flex flex-col items-center gap-2 group cursor-pointer"
                    onClick={() => setActiveMode('direct')}
                    title="切换到直接切图模式"
                >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-b-4 transition-all shadow-sm active:translate-y-0.5 ${activeMode === 'direct' ? 'bg-blue-100 border-blue-300 text-blue-500' : 'bg-blue-50 border-blue-100 text-blue-200 group-hover:text-blue-300'}`}>
                        <Scissors size={22} />
                    </div>
                    <div className={`w-2 h-2 rounded-full ${activeMode === 'direct' ? 'bg-blue-400' : 'bg-blue-100'}`}></div>
                    <div className={`text-[10px] font-bold tracking-tighter uppercase ${activeMode === 'direct' ? 'text-blue-400' : 'text-blue-200'}`}>DIRECT CUT</div>
                </div>
            </div>

            {/* Output Slot */}
            <div className="output-slot-2d"></div>

            {/* Hidden Inputs */}
            <input type="file" ref={charInputRef} onChange={handleCharFileChange} className="hidden" accept="image/*" />
            <input type="file" ref={sheetInputRef} onChange={handleSheetFileChange} className="hidden" accept="image/*" />

            {/* Help Button & Deco */}
            <button className="help-btn" onClick={() => setShowInstructions(true)} title="查看使用说明">
                <HelpCircle size={24} />
                <div className="help-deco">新手必看 ✨</div>
            </button>

            {/* Instruction Modal */}
            {showInstructions && (
                <div className="modal-overlay" onClick={() => setShowInstructions(false)}>
                    <div className="instruction-panel" onClick={e => e.stopPropagation()}>
                        <button className="close-modal-btn" onClick={() => setShowInstructions(false)}>
                            <X size={18} />
                        </button>

                        <div className="instruction-title">
                            <Sparkles size={24} />
                            <span>使用说明</span>
                            <Sparkles size={24} />
                        </div>

                        <div className="instruction-section">
                            <div className="section-title">🔑 配置 API KEY (AI 生成必填)</div>
                            <div className="section-content">
                                访问 <a href="https://apimart.ai" target="_blank" rel="noreferrer" className="contact-link">Apimart.ai</a> 获取你的 API KEY，填写在下方即可开启 AI 创作功能。
                            </div>
                            <div className="relative">
                                <input
                                    type="password"
                                    className={`api-key-input ${showKeyError ? 'error' : ''}`}
                                    placeholder="在此粘贴你的 Apimart API Key..."
                                    value={apiKey}
                                    onChange={(e) => {
                                        onApiKeyChange(e.target.value);
                                        if (e.target.value.trim()) {
                                            setShowKeyError(false);
                                            setError(null);
                                        }
                                        setShowKeySaved(true);
                                        setTimeout(() => setShowKeySaved(false), 2000);
                                    }}
                                />
                                {showKeySaved && (
                                    <div className="absolute right-3 top-[60%] -translate-y-1/2 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse z-10 pointer-events-none">
                                        保存成功 ✨
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="instruction-section">
                            <div className="section-title">✨ 双重处理模式</div>
                            <div className="section-content">
                                • <b>AI 创作</b>：点击屏幕上传单张角色图，AI 将为你自动生成并命名全套 16 张表情包。<br />
                                • <b>直接切图</b>：点击蓝色 <b>DIRECT</b> 按钮切换模式并上传整张大图，系统将自动识别并切出所有独立贴纸（支持任意排版）。
                            </div>
                        </div>

                        <div className="instruction-section">
                            <div className="section-title">🖱️ 手动微调技巧</div>
                            <div className="section-content">
                                如果系统切图不准也没关系！你可以在切图预览界面直接<b>点击手动添加</b>来框选准确的单个贴纸。
                            </div>
                        </div>

                        <div className="instruction-section">
                            <div className="section-title">💡 AI 提示词 (辅助生成)</div>
                            <div className="section-content">
                                建议在 AI 平台使用以下提示词生成最完美的大图，生成后使用"直接切图"即可：
                            </div>
                            <div className="prompt-container">
                                <div
                                    className="copy-badge"
                                    onClick={() => copyToClipboard("为图中角色设计一个卡通角色，生成 16种 LINE 贴纸。姿势和文字排版要富有创意，变化丰富，设计独特。对话应为简体中文，可以是角色在不同场景，不同情绪的，角色比例二头身，背景纯白")}
                                >
                                    复制内容
                                </div>
                                <p className="prompt-text">
                                    为图中角色设计一个卡通角色，生成 16种 LINE 贴纸。姿势和文字排版要富有创意，变化丰富，设计独特。对话应为简体中文，可以是角色在不同场景，不同情绪的，角色比例二头身，背景纯白
                                </p>
                            </div>
                        </div>

                        <div className="contact-footer">
                            如有任何建议或问题：<a href="mailto:xxlmxx21@gmail.com" className="contact-link">xxlmxx21@gmail.com</a>
                        </div>
                    </div>
                </div>
            )}
                </div>

                {/* Generated Stickers Display */}
                {generatedStickers.length > 0 && (
                    <div className="bg-white rounded-2xl border-4 border-pink-200 shadow-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-pink-600 flex items-center gap-2">
                                <Sparkles size={16} />
                                生成的贴纸 ({generatedStickers.length} 张)
                            </h3>
                            <button
                                onClick={handleDownloadAll}
                                disabled={isZipping}
                                className="cute-btn flex items-center gap-2 px-4 py-2 text-sm"
                                style={{ 
                                    borderColor: '#81C784', 
                                    color: '#2E7D32', 
                                    background: '#E8F5E9',
                                    opacity: isZipping ? 0.6 : 1,
                                    cursor: isZipping ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {isZipping ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        打包中...
                                    </>
                                ) : (
                                    <>
                                        <Download size={16} />
                                        下载全部 (ZIP)
                                    </>
                                )}
                            </button>
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                            {generatedStickers
                                .sort((a, b) => a.index - b.index)
                                .map((sticker, idx) => (
                                    <div
                                        key={sticker.id}
                                        className="relative group bg-pink-50 rounded-xl p-2 border-2 border-pink-200 hover:border-pink-400 transition-all cursor-pointer"
                                        onClick={() => handleImageClick(sticker.dataUrl)}
                                    >
                                        <img
                                            src={sticker.dataUrl}
                                            alt={`Sticker ${idx + 1}`}
                                            className="w-full h-auto rounded-lg"
                                        />
                                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-xl transition-all flex items-center justify-center">
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleImageClick(sticker.dataUrl);
                                                    }}
                                                    className="bg-white rounded-full p-2 shadow-lg hover:bg-pink-100 transition-colors"
                                                    title="查看大图"
                                                >
                                                    <ZoomIn size={16} className="text-pink-600" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCopyImage(sticker.dataUrl);
                                                    }}
                                                    className="bg-white rounded-full p-2 shadow-lg hover:bg-pink-100 transition-colors"
                                                    title="复制"
                                                >
                                                    <Copy size={16} className="text-pink-600" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDownloadImage(sticker.dataUrl, idx);
                                                    }}
                                                    className="bg-white rounded-full p-2 shadow-lg hover:bg-pink-100 transition-colors"
                                                    title="下载"
                                                >
                                                    <Download size={16} className="text-pink-600" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="absolute top-2 left-2 bg-pink-400 text-white text-xs px-2 py-0.5 rounded-full font-semibold shadow-md">
                                            🌹 #{idx + 1}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Image Viewer Modal */}
            {viewingImage && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
                    onClick={() => setViewingImage(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setViewingImage(null)}
                            className="absolute top-2 right-2 bg-pink-100 hover:bg-pink-200 rounded-full p-2 transition-colors z-10"
                        >
                            <X size={20} className="text-pink-600" />
                        </button>
                        <img
                            src={viewingImage}
                            alt="Full size sticker"
                            className="max-w-full max-h-[80vh] rounded-lg"
                        />
                        <div className="flex gap-2 mt-4 justify-center">
                            <button
                                onClick={() => {
                                    if (viewingImage) {
                                        handleCopyImage(viewingImage);
                                    }
                                }}
                                className="cute-select-btn px-4 py-2 rounded-xl border-2 bg-white border-pink-200 text-pink-400 hover:border-pink-300 flex items-center gap-2"
                            >
                                <Copy size={16} />
                                复制图片
                            </button>
                            <button
                                onClick={() => {
                                    if (viewingImage) {
                                        const index = generatedStickers.findIndex(s => s.dataUrl === viewingImage);
                                        handleDownloadImage(viewingImage, index >= 0 ? index : 0);
                                    }
                                }}
                                className="cute-select-btn px-4 py-2 rounded-xl border-2 bg-white border-pink-200 text-pink-400 hover:border-pink-300 flex items-center gap-2"
                            >
                                <Download size={16} />
                                下载图片
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

};

export default CutePrinter2D;
