/**
 * Planet Beauty AI Chatbot Widget
 * v4: Added CSS variable fallback for primary color. Retains robust JSONP handling.
 */

;(() => {
  // --- Configuration ---
  const DEFAULT_CONFIG = {
    apiUrl:
      "https://script.google.com/macros/s/AKfycbx33uAHz5Yuxki29KSqYqy7uWTv850Jp8IsGQevsbKyjNKcWj9N3suuUOkdXxr0E-fV/exec", // Default API URL
    primaryColor: "#e91e63", // Default Pink - Used if data-* and CSS var fail
    textColor: "#ffffff",
    position: "bottom-right",
    icon: "message-circle",
    welcomeMessage:
      "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
    botName: "Bella",
    apiTimeout: 30000,
    clientCacheTTL: 3600 * 1000,
    clientCacheSize: 50,
    rateLimit: 1000,
  }

  const scriptTag = document.getElementById("ai-chatbot-script")

  // --- Get Primary Color: Priority: data-attribute > CSS Variable > Default ---
  let detectedPrimaryColor = DEFAULT_CONFIG.primaryColor; // Start with default
  const dataPrimaryColor = scriptTag?.getAttribute("data-primary-color");

  if (dataPrimaryColor) {
    console.log("Chatbot: Using primary color from data-primary-color attribute.");
    detectedPrimaryColor = dataPrimaryColor;
  } else {
    // Try to detect from common Shopify CSS variables if data attribute is missing
    console.log("Chatbot: data-primary-color not set, attempting CSS variable detection.");
    const commonCssVars = [
        '--color-primary', '--colors-accent-1', '--color-accent-1', '--color-button',
        '--color-button-background', '--color-text-link', '--brand-color', '--accent-color'
    ];
    let cssVarValue = null;
    try {
        // Check on body first, then root - some themes define on body
        let styleSource = document.body;
        let computedStyle = getComputedStyle(styleSource);
        for (const varName of commonCssVars) {
            const value = computedStyle.getPropertyValue(varName)?.trim();
            if (value && value.startsWith('#')) { cssVarValue = value; break; }
        }
        // If not found on body, check root
        if (!cssVarValue) {
            styleSource = document.documentElement;
            computedStyle = getComputedStyle(styleSource);
            for (const varName of commonCssVars) {
                const value = computedStyle.getPropertyValue(varName)?.trim();
                if (value && value.startsWith('#')) { cssVarValue = value; break; }
            }
        }

        if (cssVarValue) {
             console.log(`Chatbot: Detected primary color from CSS variable (${cssVarValue})`);
             detectedPrimaryColor = cssVarValue;
        } else {
             console.log("Chatbot: Could not detect primary color from CSS variables, using default.");
        }

    } catch (e) {
        console.warn("Chatbot: Error reading CSS variables.", e);
    }
  }
  // --- End Primary Color Detection ---


  // --- Build Final Config ---
  const config = {
    ...DEFAULT_CONFIG,
    apiUrl: scriptTag?.getAttribute("data-api-url") || DEFAULT_CONFIG.apiUrl,
    apiKey: scriptTag?.getAttribute("data-api-key") || "",
    primaryColor: detectedPrimaryColor, // Use the detected or default color
    textColor: scriptTag?.getAttribute("data-text-color") || DEFAULT_CONFIG.textColor,
    position: scriptTag?.getAttribute("data-position") || DEFAULT_CONFIG.position,
    welcomeMessage: scriptTag?.getAttribute("data-welcome-message") || DEFAULT_CONFIG.welcomeMessage,
    botName: scriptTag?.getAttribute("data-bot-name") || DEFAULT_CONFIG.botName,
  }
  // console.log("Chatbot Config:", config); // Log final config for debugging

  // --- State ---
  let isOpen = false
  const messages = []
  let isTyping = false
  let lastMessageTime = 0
  let lastUserMessage = ""
  let lastRecommendedProducts = []
  const messageCache = new Map()
  let elements = null; // Populated by init()

  // --- Helper: Adjust Color ---
  function adjustColor(hex, percent) {
    try {
        let r = parseInt(hex.substring(1, 3), 16);
        let g = parseInt(hex.substring(3, 5), 16);
        let b = parseInt(hex.substring(5, 7), 16);
        // Adjust brightness by percentage factor
        const factor = 1 + percent / 100;
        r = Math.round(Math.max(0, Math.min(255, r * factor)));
        g = Math.round(Math.max(0, Math.min(255, g * factor)));
        b = Math.round(Math.max(0, Math.min(255, b * factor)));
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0');
    } catch (e) {
        console.error("Error adjusting color:", hex, e);
        return hex; // Return original on error
    }
  }

  // --- Helper: Get SVG Icon ---
  function getIconSvg(name) {
    const icons = {
      "message-circle": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
      "minimize-2": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      "x": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      "send": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
    };
    return icons[name] || icons["message-circle"];
  }

  // --- Helper: Inject Styles ---
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .ai-chatbot-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
      .ai-chatbot-widget { position: fixed; z-index: 9999; transition: all 0.3s ease; }
      .ai-chatbot-widget.bottom-right { right: 20px; bottom: 20px; }
      .ai-chatbot-widget.bottom-left { left: 20px; bottom: 20px; }
      .ai-chatbot-toggle { width: 60px; height: 60px; border-radius: 50%; background-color: ${config.primaryColor}; color: ${config.textColor}; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); border: none; outline: none; transition: transform 0.2s ease; }
      .ai-chatbot-toggle:hover { transform: scale(1.05); }
      .ai-chatbot-toggle svg { width: 28px; height: 28px; }
      .ai-chatbot-container { position: absolute; bottom: 70px; width: 350px; height: 500px; background: white; border-radius: 12px; box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; overflow: hidden; transition: all 0.3s ease; opacity: 0; transform: translateY(20px) scale(0.9); pointer-events: none; }
      .ai-chatbot-widget.bottom-right .ai-chatbot-container { right: 0; }
      .ai-chatbot-widget.bottom-left .ai-chatbot-container { left: 0; }
      .ai-chatbot-widget.open .ai-chatbot-container { opacity: 1; transform: translateY(0) scale(1); pointer-events: all; }
      .ai-chatbot-header { background: linear-gradient(to right, ${config.primaryColor}, ${adjustColor(config.primaryColor, -20)}); color: ${config.textColor}; padding: 15px; display: flex; align-items: center; justify-content: space-between; }
      .ai-chatbot-header-title { display: flex; align-items: center; font-weight: 600; }
      .ai-chatbot-header-title svg { margin-right: 8px; width: 20px; height: 20px; }
      .ai-chatbot-header-actions { display: flex; }
      .ai-chatbot-header-button { background: transparent; border: none; color: ${config.textColor}; cursor: pointer; padding: 5px; margin-left: 5px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
      .ai-chatbot-header-button:hover { background: rgba(255, 255, 255, 0.1); }
      .ai-chatbot-header-button svg { width: 16px; height: 16px; }
      .ai-chatbot-messages { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
      .ai-chatbot-message { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: fadeIn 0.3s ease-out forwards; word-wrap: break-word; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .ai-chatbot-message.bot { align-self: flex-start; background-color: #f5f5f5; border-bottom-left-radius: 4px; color: #333; } /* Added default text color */
      .ai-chatbot-message.user { align-self: flex-end; background-color: ${config.primaryColor}; color: ${config.textColor}; border-bottom-right-radius: 4px; }
      .ai-chatbot-product-section { background: #f9f9f9; padding: 0.75rem; border-radius: 12px; margin-bottom: 0.75rem; max-width: 95%; margin-right: auto; animation: fadeIn 0.5s ease-out forwards; }
      .ai-chatbot-product { display: flex; align-items: center; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; margin: 0.5rem 0; text-decoration: none; color: inherit; background: white; max-width: 100%; cursor: pointer; border: 1px solid #e5e7eb; }
      .ai-chatbot-product:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.12); }
      .ai-chatbot-product-image { width: 80px; height: 80px; flex-shrink: 0; margin: 0.5rem; border-radius: 8px; overflow: hidden; background: #eee; display: flex; align-items: center; justify-content: center; }
      .ai-chatbot-product-image img { max-width: 100%; max-height: 100%; object-fit: cover; display: block; } /* Added display block */
      .ai-chatbot-product-info { padding: 8px; flex: 1; min-width: 0; }
      .ai-chatbot-product-name { font-weight: 600; font-size: 13px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #333; } /* Added color */
      .ai-chatbot-product-description { font-size: 12px; color: #666; margin: 3px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .ai-chatbot-product-price { font-weight: 600; color: ${config.primaryColor}; font-size: 13px; }
      .ai-chatbot-product-match { font-size: 0.7rem; color: #777; margin-top: 0.1rem; font-style: italic; }
      .ai-chatbot-typing { display: flex; align-items: center; gap: 0.25rem; padding: 10px 14px; border-radius: 18px; font-size: 14px; max-width: 80%; align-self: flex-start; background-color: #f5f5f5; border-bottom-left-radius: 4px; animation: fadeIn 0.3s ease-out forwards; }
      .ai-chatbot-typing-text { font-size: 0.85rem; opacity: 0.7; margin-right: 5px; color: #333; } /* Added color */
      .ai-chatbot-typing-dot { width: 7px; height: 7px; background: ${config.primaryColor}; border-radius: 50%; display: inline-block; }
      @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
      .ai-chatbot-typing-dot:nth-child(2) { animation: bounce 0.6s infinite ease-in-out; } /* Adjusted index */
      .ai-chatbot-typing-dot:nth-child(3) { animation: bounce 0.6s infinite 0.1s ease-in-out; } /* Adjusted index */
      .ai-chatbot-typing-dot:nth-child(4) { animation: bounce 0.6s infinite 0.2s ease-in-out; } /* Adjusted index */
      .ai-chatbot-suggested-questions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; margin-bottom: 10px; max-width: 95%; animation: fadeIn 0.5s ease-out forwards; }
      .ai-chatbot-suggested-question { background-color: #f5f5f5; border: 1px solid ${config.primaryColor}; color: ${config.primaryColor}; border-radius: 20px; padding: 8px 12px; font-size: 12px; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .ai-chatbot-suggested-question:hover { background: ${config.primaryColor}; color: white; transform: scale(1.05); }
      .ai-chatbot-input { padding: 15px; border-top: 1px solid #e0e0e0; display: flex; align-items: center; }
      .ai-chatbot-input-field { flex: 1; border: 1px solid #e0e0e0; border-radius: 20px; padding: 8px 15px; font-size: 14px; outline: none; transition: border-color 0.2s; color: #333; } /* Added color */
      .ai-chatbot-input-field:focus { border-color: ${config.primaryColor}; }
      .ai-chatbot-send-button { background-color: ${config.primaryColor}; color: ${config.textColor}; border: none; border-radius: 50%; width: 36px; height: 36px; margin-left: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s; }
      .ai-chatbot-send-button:hover { transform: scale(1.05); }
      .ai-chatbot-send-button:disabled { background-color: #cccccc; cursor: not-allowed; transform: none; }
      .ai-chatbot-send-button svg { width: 18px; height: 18px; }
      .ai-chatbot-error { background: #fef2f2; color: #dc2626; padding: 10px 14px; border-radius: 18px; font-size: 14px; max-width: 80%; align-self: flex-start; border-bottom-left-radius: 4px; margin-bottom: 10px; border: 1px solid #fecaca; animation: fadeIn 0.3s ease-out forwards; }
      .ai-chatbot-retry { background: none; border: none; color: ${config.primaryColor}; text-decoration: underline; cursor: pointer; font-size: 0.85rem; margin-left: 0.5rem; font-weight: 500; }
      @media (max-width: 480px) {
        .ai-chatbot-container { width: calc(100vw - 40px); height: 60vh; max-height: 500px; }
        .ai-chatbot-widget.bottom-right .ai-chatbot-container, .ai-chatbot-widget.bottom-left .ai-chatbot-container { left: 50%; right: auto; transform: translateX(-50%) translateY(20px) scale(0.9); }
        .ai-chatbot-widget.open .ai-chatbot-container { transform: translateX(-50%) translateY(0) scale(1); }
        .ai-chatbot-product-image { width: 60px; height: 60px; }
      }
    `;
    document.head.appendChild(style);
  }

  // --- Helper: Basic HTML Sanitizer ---
  function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    const tempDiv = document.createElement("div");
    tempDiv.textContent = html; // Primarily rely on textContent for safety
    let sanitized = tempDiv.innerHTML;
    // Very cautiously allow specific tags if absolutely needed from backend
    // Example: Allow <b>, <i>, <br>
    sanitized = sanitized.replace(/<b>/g, '<b>').replace(/<\/b>/g, '</b>');
    sanitized = sanitized.replace(/<i>/g, '<i>').replace(/<\/i>/g, '</i>');
    sanitized = sanitized.replace(/<br\s*\/?>/g, '<br>');
    // Avoid allowing complex tags like <ul>, <li> unless backend structure is guaranteed safe
    return sanitized;
  }

  // --- Helper: Scroll To Bottom ---
  function scrollToBottom() {
    if (elements && elements.messagesArea) {
        const area = elements.messagesArea;
        // Use requestAnimationFrame for smoother scrolling after render
        requestAnimationFrame(() => {
            if ('scrollBehavior' in document.documentElement.style) {
                area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
            } else {
                area.scrollTop = area.scrollHeight; // Fallback
            }
        });
    }
  }

  // --- Helper: Add Message to DOM ---
  function renderMessage(message) {
    if (!elements || !elements.messagesArea) {
        console.error("Cannot render message, elements not ready.");
        return;
    }
    const messageEl = document.createElement("div");
    messageEl.className = `ai-chatbot-message ${message.sender}`;
    messageEl.innerHTML = sanitizeHtml(message.text); // Sanitize before inserting
    elements.messagesArea.appendChild(messageEl);
    scrollToBottom(); // Scroll after adding the element
  }

  // --- Helper: Add Message to State & Render ---
  function addMessage(text, sender) {
    const message = { text, sender, timestamp: new Date() };
    messages.push(message);
    renderMessage(message); // Render calls scrollToBottom
  }

  // --- Helper: Show Typing Indicator ---
  function showTypingIndicator() {
    if (isTyping || !elements || !elements.messagesArea) return;
    // Remove any existing indicator first
    hideTypingIndicator();
    isTyping = true;
    const typingIndicator = document.createElement("div");
    typingIndicator.className = "ai-chatbot-typing"; // Use this class for removal
    typingIndicator.setAttribute("role", "status");
    typingIndicator.setAttribute("aria-live", "polite");
    typingIndicator.innerHTML = `
      <span class="ai-chatbot-typing-text">${config.botName} is typing</span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
    `;
    elements.messagesArea.appendChild(typingIndicator);
    scrollToBottom();
  }

  // --- Helper: Hide Typing Indicator ---
  function hideTypingIndicator() {
    if (!elements || !elements.messagesArea) return;
    const typingIndicator = elements.messagesArea.querySelector(".ai-chatbot-typing");
    if (typingIndicator) {
      typingIndicator.remove();
    }
    isTyping = false; // Ensure state is reset
  }

  // --- Helper: Add Error Message ---
  function addErrorMessage(errorText, retryQuery = null) {
    if (!elements || !elements.messagesArea) return;
    const errorDiv = document.createElement("div");
    errorDiv.className = "ai-chatbot-error";
    errorDiv.textContent = errorText; // Display plain text error
    if (retryQuery) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "ai-chatbot-retry";
      retryBtn.textContent = "Retry";
      retryBtn.onclick = () => { errorDiv.remove(); sendMessage(retryQuery); };
      errorDiv.appendChild(retryBtn);
    }
    elements.messagesArea.appendChild(errorDiv);
    scrollToBottom();
  }

  // --- Helper: Display Products ---
  function displayProducts(products) {
    if (!products || !Array.isArray(products) || products.length === 0 || !elements || !elements.messagesArea) return;
    const productSection = document.createElement("div");
    productSection.className = "ai-chatbot-product-section";
    products.forEach((product) => {
      if (!product || typeof product !== "object") return;
      const productCard = document.createElement("a");
      productCard.className = "ai-chatbot-product";
      productCard.href = sanitizeHtml(product.url || '#'); // Sanitize URL
      productCard.target = "_blank";
      productCard.rel = "noopener noreferrer";
      const placeholderImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
      productCard.innerHTML = `
        <div class="ai-chatbot-product-image">
          <img src="${sanitizeHtml(product.image || placeholderImg)}"
               alt="${sanitizeHtml(product.name || "Product")}"
               loading="lazy"
               onerror="this.onerror=null; this.src='${placeholderImg}'; this.alt='Image failed to load';">
        </div>
        <div class="ai-chatbot-product-info">
          <div class="ai-chatbot-product-name">${sanitizeHtml(product.name || "Product Name")}</div>
          <div class="ai-chatbot-product-description">${sanitizeHtml(product.description || "No description available")}</div>
          ${product.price ? `<div class="ai-chatbot-product-price">${sanitizeHtml(product.price)}</div>` : ''}
          ${product.match_reason ? `<div class="ai-chatbot-product-match">${sanitizeHtml(product.match_reason)}</div>` : ''}
        </div>
      `;
      productSection.appendChild(productCard);
    });
    elements.messagesArea.appendChild(productSection);
    scrollToBottom();
  }

  // --- Helper: Add Suggested Questions ---
  function addSuggestedQuestions(questions) {
    if (!questions || !Array.isArray(questions) || questions.length === 0 || !elements || !elements.messagesArea) return;
    // Remove existing suggestions first to prevent duplicates
    const existingContainer = elements.messagesArea.querySelector('.ai-chatbot-suggested-questions');
    if (existingContainer) existingContainer.remove();

    const suggestedQuestionsContainer = document.createElement("div");
    suggestedQuestionsContainer.className = "ai-chatbot-suggested-questions";
    questions.forEach((question) => {
      const questionButton = document.createElement("button");
      questionButton.className = "ai-chatbot-suggested-question";
      questionButton.textContent = question;
      questionButton.onclick = () => { // Use onclick for simplicity here
        if (elements && elements.inputField) {
            elements.inputField.value = question;
            elements.sendButton.disabled = false; // Enable send button
            sendMessage(); // Send the message directly
        }
      };
      suggestedQuestionsContainer.appendChild(questionButton);
    });
    elements.messagesArea.appendChild(suggestedQuestionsContainer);
    scrollToBottom();
  }

  // --- Helper: Toggle Chat ---
  function toggleChat() {
    isOpen = !isOpen;
    elements.widget.classList.toggle("open", isOpen);
    if (isOpen && elements.inputField) {
      elements.inputField.focus();
    }
  }

  // --- Helper: Caching ---
  function getCachedResponse(query) {
    const key = simpleHash(query);
    const cached = messageCache.get(key);
    if (cached && Date.now() - cached.timestamp < config.clientCacheTTL) {
      return cached.data;
    }
    if (cached) messageCache.delete(key); // Evict expired
    return null;
  }
  function setCachedResponse(query, data) {
    const key = simpleHash(query);
    if (messageCache.size >= config.clientCacheSize && !messageCache.has(key)) {
      const oldestKey = messageCache.keys().next().value;
      if (oldestKey) messageCache.delete(oldestKey);
    }
    messageCache.set(key, { data: data, timestamp: Date.now() });
  }
  function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return "pb_h_0";
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return "pb_h_" + Math.abs(hash).toString(36);
  }

  // --- Helper: Create Widget DOM ---
  function createWidget() {
    const widget = document.createElement("div");
    widget.className = `ai-chatbot-widget ${config.position}`;
    widget.innerHTML = `
      <button class="ai-chatbot-toggle" aria-label="Open chat">${getIconSvg(config.icon)}</button>
      <div class="ai-chatbot-container">
        <div class="ai-chatbot-header">
          <div class="ai-chatbot-header-title">${getIconSvg("message-circle")} <span>${config.botName} Assistant</span></div>
          <div class="ai-chatbot-header-actions">
            <button class="ai-chatbot-header-button" aria-label="Minimize chat">${getIconSvg("minimize-2")}</button>
            <button class="ai-chatbot-header-button" aria-label="Close chat">${getIconSvg("x")}</button>
          </div>
        </div>
        <div class="ai-chatbot-messages"></div>
        <div class="ai-chatbot-input">
          <input class="ai-chatbot-input-field" type="text" placeholder="Type your message...">
          <button class="ai-chatbot-send-button" aria-label="Send message" disabled>${getIconSvg("send")}</button>
        </div>
      </div>
    `;

    // Get references and add listeners
    const toggleBtn = widget.querySelector('.ai-chatbot-toggle');
    const minimizeBtn = widget.querySelector('.ai-chatbot-header-actions button[aria-label="Minimize chat"]');
    const closeBtn = widget.querySelector('.ai-chatbot-header-actions button[aria-label="Close chat"]');
    const inputField = widget.querySelector('.ai-chatbot-input-field');
    const sendButton = widget.querySelector('.ai-chatbot-send-button');
    const messagesArea = widget.querySelector('.ai-chatbot-messages');
    const container = widget.querySelector('.ai-chatbot-container');

    toggleBtn.addEventListener('click', toggleChat);
    minimizeBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);
    sendButton.addEventListener('click', () => sendMessage()); // Use arrow function to call sendMessage without args
    inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !sendButton.disabled) sendMessage();
    });
    inputField.addEventListener('input', () => {
      sendButton.disabled = !inputField.value.trim();
    });

    document.body.appendChild(widget);

    // Return references needed globally within the IIFE
    return { widget, toggle: toggleBtn, container, messagesArea, inputField, sendButton };
  }

  // --- Robust JSONP Request Function ---
  function makeJsonpRequest(baseUrl, params, callbackNamePrefix, timeoutDuration, successCallback, errorCallback) {
    const url = new URL(baseUrl);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    const callbackName = callbackNamePrefix + Math.random().toString(36).substring(2, 15);
    url.searchParams.append("callback", callbackName);

    let script = document.createElement("script");
    let timeoutId = null;
    let completed = false; // Flag to prevent double execution

    const cleanup = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        if (window[callbackName]) {
            try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
        }
        if (script && script.parentNode) { script.parentNode.removeChild(script); script = null; }
    };

    // Define the global callback function *before* appending script
    window[callbackName] = (data) => {
        if (completed) return; completed = true;
        cleanup();
        successCallback(data);
    };

    script.onerror = () => {
        if (completed) return; completed = true;
        console.error("JSONP request failed to load script:", url.toString());
        cleanup();
        errorCallback("Script load error.");
    };

    timeoutId = setTimeout(() => {
        if (completed) return; completed = true;
        console.warn("JSONP request timed out:", url.toString());
        cleanup();
        errorCallback("Request timed out.");
    }, timeoutDuration);

    script.src = url.toString();
    document.head.appendChild(script);
  }

  // --- Fetch Initial Data (Uses robust JSONP) ---
  function fetchInitialData() {
    const params = { action: "get_initial_data" };
    if (config.apiKey) params.apiKey = config.apiKey;

    makeJsonpRequest(
      config.apiUrl, params, "chatbotInitCb_", config.apiTimeout,
      // Success
      (data) => {
        if (data && data.error) {
          console.error("Error fetching initial data:", data.error);
          addMessage(config.welcomeMessage, "bot");
        } else if (data) {
          addMessage(data.welcomeMessage || config.welcomeMessage, "bot");
          if (data.suggestedQuestions) addSuggestedQuestions(data.suggestedQuestions);
        } else {
          addMessage(config.welcomeMessage, "bot"); // Fallback if data is null/invalid
        }
      },
      // Error
      (errorMsg) => {
        console.error("Error fetching initial data (network/timeout):", errorMsg);
        addMessage(config.welcomeMessage, "bot"); // Fallback
      }
    );
  }

  // --- Send Message (Uses robust JSONP) ---
  function sendMessage(customMessage = null) {
    if (!elements || !elements.inputField || !elements.sendButton) return;
    const message = customMessage || elements.inputField.value.trim();
    if (!message) return;
    const now = Date.now();
    if (now - lastMessageTime < config.rateLimit) { addErrorMessage(`Please wait...`); return; }
    lastMessageTime = now; lastUserMessage = message;
    if (!customMessage) elements.inputField.value = "";
    elements.sendButton.disabled = true;
    addMessage(message, "user"); showTypingIndicator();
    const cachedResponse = getCachedResponse(message);
    if (cachedResponse) { setTimeout(() => { hideTypingIndicator(); handleResponse(cachedResponse); }, 300); return; }
    const history = messages.slice(-7, -1).map(msg => ({ role: msg.sender === "user" ? "user" : "assistant", content: msg.text }));
    const params = { action: "search", query: message, history: JSON.stringify(history) };
    if (config.apiKey) params.apiKey = config.apiKey;

    makeJsonpRequest(
        config.apiUrl, params, "chatbotMsgCb_", config.apiTimeout,
        // Success
        (data) => {
            hideTypingIndicator();
            if (data && data.error) {
                addErrorMessage(`Error: ${data.error}`, message);
            } else if (data) {
                setCachedResponse(message, data);
                handleResponse(data);
            } else {
                 addErrorMessage("Received invalid response.", message);
            }
        },
        // Error
        (errorMsg) => {
            hideTypingIndicator();
            addErrorMessage(`${errorMsg}. Please try again.`, message);
        }
    );
  }

  // --- Handle Backend Response ---
  function handleResponse(data) {
    // Display the bot's text response
    if (data.text) {
      addMessage(data.text, "bot");
    } else {
      addMessage("Sorry, I couldn't process that properly. Can you try asking differently?", "bot");
    }
    // Display products if available
    if (data.products && Array.isArray(data.products) && data.products.length > 0) {
      lastRecommendedProducts = data.products;
      displayProducts(data.products);
    } else {
      lastRecommendedProducts = []; // Clear if no products
    }
    // Display suggested questions if available in the response
    if (data.suggestedQuestions && Array.isArray(data.suggestedQuestions) && data.suggestedQuestions.length > 0) {
      addSuggestedQuestions(data.suggestedQuestions);
    }
  }

  // --- Initialize ---
  function init() {
    // Config is built above, including color detection
    injectStyles(); // Inject styles using the final config
    const els = createWidget(); // Create DOM elements
    // fetchInitialData is called within createWidget in this version,
    // but calling it here ensures it happens *after* elements are assigned
    // fetchInitialData(); // Let's call it after assigning els to the global 'elements'
    return els;
  }

  // Defer initialization until DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        elements = init(); // Assign the return value of init to the global 'elements'
        fetchInitialData(); // Now fetch data
    });
  } else {
    // DOM is already ready
    elements = init(); // Assign the return value of init to the global 'elements'
    fetchInitialData(); // Now fetch data
  }

})()
