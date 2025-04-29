/**
 * Shopify AI Chatbot Widget
 * Complete implementation with fixed JSONP callback issue, dynamic theming, DOMPurify sanitization,
 * persistent caching, preloader, and enhanced accessibility.
 * Based on Planet Beauty AI Chatbot with improvements from reference implementation.
 */

;(() => {
  // Configuration
  const DEFAULT_CONFIG = {
    apiUrl: "https://script.google.com/macros/s/AKfycbx33uAHz5Yuxki29KSqYqy7uWTv850Jp8IsGQevsbKyjNKcWj9N3suuUOkdXxr0E-fV/exec",
    primaryColor: "#e91e63",
    textColor: "#ffffff",
    position: "bottom-right",
    icon: "message-circle",
    welcomeMessage: "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
    botName: "Bella",
    apiTimeout: 45000, // 45 seconds to handle potential backend delays
    clientCacheTTL: 3600 * 1000, // 1 hour
    clientCacheSize: 50,
    rateLimit: 1000, // 1 second between messages
  };

  // Get configuration from script tag data attributes
  const scriptTag = document.getElementById("ai-chatbot-script");
  const config = {
    ...DEFAULT_CONFIG,
    apiUrl: scriptTag?.getAttribute("data-api-url") || DEFAULT_CONFIG.apiUrl,
    apiKey: scriptTag?.getAttribute("data-api-key") || "",
    primaryColor: scriptTag?.getAttribute("data-primary-color") || DEFAULT_CONFIG.primaryColor,
    textColor: scriptTag?.getAttribute("data-text-color") || DEFAULT_CONFIG.textColor,
    position: scriptTag?.getAttribute("data-position") || DEFAULT_CONFIG.position,
    welcomeMessage: scriptTag?.getAttribute("data-welcome-message") || DEFAULT_CONFIG.welcomeMessage,
    botName: scriptTag?.getAttribute("data-bot-name") || DEFAULT_CONFIG.botName,
  };

  // State
  let isOpen = false;
  const messages = [];
  let isTyping = false;
  let lastMessageTime = 0;
  let lastUserMessage = "";
  let lastRecommendedProducts = [];

  // Client-side cache
  const messageCache = new Map(); // For in-memory fallback if localStorage fails

  // Inject styles with CSS variables
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --primary: ${config.primaryColor};
        --text: ${config.textColor};
        --bg-light: #ffffff;
        --bg-dark: #1a1a1a;
        --text-dark: #ffffff;
        --message-bg: #f5f5f5;
        --shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      .ai-chatbot-widget * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      }
      .ai-chatbot-widget {
        position: fixed;
        z-index: 9999;
        transition: all 0.3s ease;
      }
      .ai-chatbot-widget.bottom-right {
        right: 20px;
        bottom: 20px;
      }
      .ai-chatbot-widget.bottom-left {
        left: 20px;
        bottom: 20px;
      }
      .ai-chatbot-toggle {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background-color: var(--primary);
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: var(--shadow);
        border: none;
        outline: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        animation: bubblePulse 2s infinite ease-in-out;
      }
      .ai-chatbot-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }
      .ai-chatbot-toggle svg {
        width: 32px;
        height: 32px;
      }
      .ai-chatbot-container {
        position: absolute;
        bottom: 80px;
        width: 525px;
        height: 750px;
        background: var(--bg-light);
        border-radius: 16px;
        box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.3s ease;
        opacity: 0;
        transform: translateY(20px) scale(0.9);
        pointer-events: none;
      }
      .dark-mode .ai-chatbot-container {
        background: var(--bg-dark);
        color: var(--text-dark);
      }
      .ai-chatbot-widget.bottom-right .ai-chatbot-container {
        right: 0;
      }
      .ai-chatbot-widget.bottom-left .ai-chatbot-container {
        left: 0;
      }
      .ai-chatbot-widget.open .ai-chatbot-container {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: all;
      }
      .ai-chatbot-header {
        background: linear-gradient(to right, var(--primary), ${adjustColor(config.primaryColor, -20)});
        color: var(--text);
        padding: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .ai-chatbot-header-title {
        display: flex;
        align-items: center;
        font-weight: 600;
        font-size: 18px;
      }
      .ai-chatbot-header-title svg {
        margin-right: 10px;
        width: 24px;
        height: 24px;
      }
      .ai-chatbot-header-actions {
        display: flex;
      }
      .ai-chatbot-header-button {
        background: transparent;
        border: none;
        color: var(--text);
        cursor: pointer;
        padding: 6px;
        margin-left: 6px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
      }
      .ai-chatbot-header-button:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .ai-chatbot-header-button svg {
        width: 18px;
        height: 18px;
      }
      .ai-chatbot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        scroll-behavior: smooth;
      }
      .ai-chatbot-message {
        max-width: 80%;
        padding: 12px 16px;
        border-radius: 20px;
        font-size: 15px;
        line-height: 1.5;
        animation: bubblePop 0.3s ease-out forwards;
        position: relative;
        box-shadow: var(--shadow);
      }
      @keyframes bubblePop {
        0% { opacity: 0; transform: scale(0.8) translateY(10px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes bubblePulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      .ai-chatbot-message.bot {
        align-self: flex-start;
        background-color: var(--message-bg);
        border-bottom-left-radius: 4px;
      }
      .dark-mode .ai-chatbot-message.bot {
        background-color: #2a2a2a;
      }
      .ai-chatbot-message.user {
        align-self: flex-end;
        background-color: var(--primary);
        color: var(--text);
        border-bottom-right-radius: 4px;
      }
      .ai-chatbot-product-section {
        background: var(--message-bg);
        padding: 1rem;
        border-radius: 14px;
        margin-bottom: 1rem;
        max-width: 95%;
        margin-right: auto;
        animation: bubblePop 0.5s ease-out forwards;
      }
      .dark-mode .ai-chatbot-product-section {
        background: #2a2a2a;
      }
      .ai-chatbot-product {
        display: flex;
        align-items: center;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: var(--shadow);
        transition: transform 0.2s, box-shadow 0.2s;
        margin: 0.75rem 0;
        text-decoration: none;
        color: inherit;
        background: var(--bg-light);
        max-width: 100%;
        cursor: pointer;
        border: 1px solid #e5e7eb;
      }
      .dark-mode .ai-chatbot-product {
        background: #2a2a2a;
        border-color: #444;
      }
      .ai-chatbot-product:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.12);
      }
      .ai-chatbot-product-image {
        width: 100px;
        height: 100px;
        flex-shrink: 0;
        margin: 0.75rem;
        border-radius: 10px;
        overflow: hidden;
        background: #eee;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ai-chatbot-product-image img {
        max-width: 100%;
        max-height: 100%;
        object-fit: cover;
      }
      .ai-chatbot-product-info {
        padding: 10px;
        flex: 1;
        min-width: 0;
      }
      .ai-chatbot-product-name {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ai-chatbot-product-description {
        font-size: 13px;
        color: #666;
        margin: 4px 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .dark-mode .ai-chatbot-product-description {
        color: #aaa;
      }
      .ai-chatbot-product-price {
        font-weight: 600;
        color: var(--primary);
        font-size: 14px;
      }
      .ai-chatbot-product-match {
        font-size: 0.8rem;
        color: #777;
        margin-top: 0.2rem;
        font-style: italic;
      }
      .dark-mode .ai-chatbot-product-match {
        color: #999;
      }
      .ai-chatbot-typing {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        padding: 12px 16px;
        border-radius: 20px;
        font-size: 14px;
        max-width: 80%;
        align-self: flex-start;
        background-color: var(--message-bg);
        border-bottom-left-radius: 4px;
        animation: bubblePop 0.3s ease-out forwards;
        box-shadow: var(--shadow);
      }
      .dark-mode .ai-chatbot-typing {
        background-color: #2a2a2a;
      }
      .ai-chatbot-typing-text {
        font-size: 0.9rem;
        opacity: 0.8;
      }
      .ai-chatbot-typing-dot {
        width: 8px;
        height: 8px;
        background: var(--primary);
        border-radius: 50%;
        display: inline-block;
        animation: typingWave 1.2s infinite ease-in-out;
      }
      @keyframes typingWave {
        0%, 100% { transform: translateY(0); opacity: 0.4; }
        50% { transform: translateY(-6px); opacity: 1; }
      }
      .ai-chatbot-typing-dot:nth-child(1) { animation-delay: 0s; }
      .ai-chatbot-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .ai-chatbot-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      .ai-chatbot-suggested-questions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
        margin-bottom: 12px;
        max-width: 95%;
        animation: bubblePop 0.5s ease-out forwards;
      }
      .ai-chatbot-suggested-question {
        background-color: var(--message-bg);
        border: 1px solid var(--primary);
        border-radius: 22px;
        padding: 10px 14px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        box-shadow: var(--shadow);
      }
      .dark-mode .ai-chatbot-suggested-question {
        background-color: #2a2a2a;
      }
      .ai-chatbot-suggested-question:hover {
        background: var(--primary);
        color: var(--text);
        transform: scale(1.05);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      }
      .ai-chatbot-input {
        padding: 20px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
      }
      .dark-mode .ai-chatbot-input {
        border-top-color: #444;
      }
      .ai-chatbot-input-field {
        flex: 1;
        border: 1px solid #e0e0e0;
        border-radius: 22px;
        padding: 10px 18px;
        font-size: 15px;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .dark-mode .ai-chatbot-input-field {
        border-color: #444;
        background: #2a2a2a;
        color: var(--text-dark);
      }
      .ai-chatbot-input-field:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(233, 30, 99, 0.1);
      }
      .ai-chatbot-send-button {
        background-color: var(--primary);
        color: var(--text);
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        margin-left: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        box-shadow: var(--shadow);
      }
      .ai-chatbot-send-button:hover {
        transform: scale(1.1);
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
      }
      .ai-chatbot-send-button:disabled {
        background-color: #cccccc;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      .ai-chatbot-send-button svg {
        width: 20px;
        height: 20px;
      }
      .ai-chatbot-error {
        background: #fef2f2;
        color: #dc2626;
        padding: 12px 16px;
        border-radius: 20px;
        font-size: 14px;
        max-width: 80%;
        align-self: flex-start;
        border-bottom-left-radius: 4px;
        margin-bottom: 12px;
        border: 1px solid #fecaca;
        animation: bubblePop 0.3s ease-out forwards;
      }
      .ai-chatbot-retry {
        background: none;
        border: none;
        color: var(--primary);
        text-decoration: underline;
        cursor: pointer;
        font-size: 0.9rem;
        margin-left: 0.75rem;
        font-weight: 500;
      }
      .ai-chatbot-preloader {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 255, 255, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        transition: opacity 0.3s ease;
      }
      .dark-mode .ai-chatbot-preloader {
        background: rgba(0, 0, 0, 0.9);
      }
      .ai-chatbot-preloader.hidden {
        opacity: 0;
        pointer-events: none;
      }
      .ai-chatbot-preloader-spinner {
        width: 40px;
        height: 40px;
        border: 4px solid var(--primary);
        border-top: 4px solid transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @media (max-width: 480px) and (orientation: portrait) {
        .ai-chatbot-container {
          width: 100vw;
          height: 100vh;
          max-height: none;
          border-radius: 0;
          bottom: 0;
          top: 0;
          left: 0;
          right: 0;
          transform: none;
        }
        .ai-chatbot-widget.bottom-right .ai-chatbot-container,
        .ai-chatbot-widget.bottom-left .ai-chatbot-container {
          transform: none;
        }
        .ai-chatbot-widget.open .ai-chatbot-container {
          transform: none;
        }
        .ai-chatbot-product-image {
          width: 80px;
          height: 80px;
        }
        .ai-chatbot-header {
          padding: 15px;
        }
        .ai-chatbot-input {
          padding: 15px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Helper function to adjust color brightness
  function adjustColor(hex, percent) {
    let r = parseInt(hex.substring(1, 3), 16);
    let g = parseInt(hex.substring(3, 5), 16);
    let b = parseInt(hex.substring(5, 7), 16);
    r = Math.max(0, Math.min(255, r + percent));
    g = Math.max(0, Math.min(255, g + percent));
    b = Math.max(0, Math.min(255, b + percent));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Create widget DOM
  function createWidget() {
    const widget = document.createElement("div");
    widget.className = `ai-chatbot-widget ${config.position}`;

    // Add preloader
    const preloader = document.createElement("div");
    preloader.className = "ai-chatbot-preloader";
    preloader.setAttribute("aria-label", "Loading chatbot");
    preloader.innerHTML = '<div class="ai-chatbot-preloader-spinner"></div>';
    document.body.appendChild(preloader);

    const toggle = document.createElement("button");
    toggle.className = "ai-chatbot-toggle";
    toggle.setAttribute("aria-label", "Open chat");
    toggle.innerHTML = getIconSvg(config.icon);
    toggle.addEventListener("click", toggleChat);

    const container = document.createElement("div");
    container.className = "ai-chatbot-container";

    const header = document.createElement("div");
    header.className = "ai-chatbot-header";

    const headerTitle = document.createElement("div");
    headerTitle.className = "ai-chatbot-header-title";
    headerTitle.innerHTML = `${getIconSvg("message-circle")} <span>Beauty Assistant</span>`;

    const headerActions = document.createElement("div");
    headerActions.className = "ai-chatbot-header-actions";

    const themeToggleButton = document.createElement("button");
    themeToggleButton.className = "ai-chatbot-header-button";
    themeToggleButton.setAttribute("aria-label", "Toggle theme");
    themeToggleButton.innerHTML = getIconSvg("sun");
    themeToggleButton.addEventListener("click", () => {
      document.body.classList.toggle("dark-mode");
      themeToggleButton.innerHTML = document.body.classList.contains("dark-mode") ? getIconSvg("moon") : getIconSvg("sun");
    });

    const minimizeButton = document.createElement("button");
    minimizeButton.className = "ai-chatbot-header-button";
    minimizeButton.setAttribute("aria-label", "Minimize chat");
    minimizeButton.innerHTML = getIconSvg("minimize-2");
    minimizeButton.addEventListener("click", toggleChat);

    const closeButton = document.createElement("button");
    closeButton.className = "ai-chatbot-header-button";
    closeButton.setAttribute("aria-label", "Close chat");
    closeButton.innerHTML = getIconSvg("x");
    closeButton.addEventListener("click", toggleChat);

    headerActions.appendChild(themeToggleButton);
    headerActions.appendChild(minimizeButton);
    headerActions.appendChild(closeButton);

    header.appendChild(headerTitle);
    header.appendChild(headerActions);

    const messagesArea = document.createElement("div");
    messagesArea.className = "ai-chatbot-messages";
    messagesArea.setAttribute("aria-live", "polite");

    const inputArea = document.createElement("div");
    inputArea.className = "ai-chatbot-input";

    const inputField = document.createElement("input");
    inputField.className = "ai-chatbot-input-field";
    inputField.type = "text";
    inputField.placeholder = "Type your message...";
    inputField.setAttribute("aria-label", "Message input");
    inputField.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !sendButton.disabled) {
        sendMessage();
      }
    });
    inputField.addEventListener("input", () => {
      sendButton.disabled = !inputField.value.trim();
    });

    const sendButton = document.createElement("button");
    sendButton.className = "ai-chatbot-send-button";
    sendButton.setAttribute("aria-label", "Send message");
    sendButton.innerHTML = getIconSvg("send");
    sendButton.disabled = true;
    sendButton.addEventListener("click", sendMessage);

    inputArea.appendChild(inputField);
    inputArea.appendChild(sendButton);

    container.appendChild(header);
    container.appendChild(messagesArea);
    container.appendChild(inputArea);

    widget.appendChild(toggle);
    widget.appendChild(container);

    document.body.appendChild(widget);

    // Initialize data fetch and remove preloader
    fetchInitialData().finally(() => {
      setTimeout(() => {
        preloader.classList.add("hidden");
        setTimeout(() => preloader.remove(), 300);
      }, 500);
    });

    return {
      widget,
      toggle,
      container,
      messagesArea,
      inputField,
      sendButton,
    };
  }

  // Fetch initial welcome message and suggested questions
  function fetchInitialData() {
    return new Promise((resolve) => {
      let script = null;
      let callbackName = null;
      let timeoutId = null;
      let isResponseReceived = false;

      try {
        const url = new URL(config.apiUrl);
        url.searchParams.append("action", "get_initial_data");
        if (config.apiKey) {
          url.searchParams.append("apiKey", config.apiKey);
        }

        callbackName = `chatbotInitCallback_${Math.random().toString(36).substring(2, 15)}`;

        window[callbackName] = (data) => {
          isResponseReceived = true;
          clearTimeout(timeoutId);
          try {
            if (data.error) {
              console.warn("Initial data fetch error:", data.error);
              addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
            } else {
              addMessage(data.welcomeMessage || "Welcome to Planet Beauty! How can I help you today?", "bot");
              if (data.suggestedQuestions && Array.isArray(data.suggestedQuestions)) {
                addSuggestedQuestions(data.suggestedQuestions);
              }
            }
            resolve();
          } catch (err) {
            console.error("Error processing initial data:", err);
            addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
            resolve();
          } finally {
            if (window[callbackName]) {
              delete window[callbackName];
            }
            if (script && script.parentNode) {
              document.head.removeChild(script);
            }
          }
        };

        script = document.createElement("script");
        script.src = `${url.toString()}&callback=${callbackName}`;
        script.onerror = () => {
          console.error("Failed to load initial data script");
          if (!isResponseReceived) {
            addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
          }
          if (window[callbackName]) {
            delete window[callbackName];
          }
          if (script && script.parentNode) {
            document.head.removeChild(script);
          }
          resolve();
        };

        document.head.appendChild(script);

        timeoutId = setTimeout(() => {
          if (!isResponseReceived) {
            console.warn("Initial data fetch timed out");
            addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
            if (window[callbackName]) {
              delete window[callbackName];
            }
            if (script && script.parentNode) {
              document.head.removeChild(script);
            }
            resolve();
          }
        }, config.apiTimeout);
      } catch (error) {
        console.error("Error setting up initial data fetch:", error);
        addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script && script.parentNode) {
          document.head.removeChild(script);
        }
        resolve();
      }
    });
  }

  // Add suggested questions
  function addSuggestedQuestions(questions) {
    if (!questions || !Array.isArray(questions) || questions.length === 0) return;

    const suggestedQuestionsContainer = document.createElement("div");
    suggestedQuestionsContainer.className = "ai-chatbot-suggested-questions";

    questions.forEach((question) => {
      const questionButton = document.createElement("button");
      questionButton.className = "ai-chatbot-suggested-question";
      questionButton.textContent = question;
      questionButton.setAttribute("aria-label", `Ask: ${question}`);
      questionButton.addEventListener("click", () => {
        elements.inputField.value = question;
        sendMessage();
      });
      suggestedQuestionsContainer.appendChild(questionButton);
    });

    elements.messagesArea.appendChild(suggestedQuestionsContainer);
    scrollToBottom();
  }

  // Toggle chat open/closed
  function toggleChat() {
    isOpen = !isOpen;
    elements.widget.classList.toggle("open", isOpen);
    if (isOpen) {
      elements.inputField.focus();
    }
  }

  // Add a message
  function addMessage(text, sender) {
    const message = {
      text,
      sender,
      timestamp: new Date(),
    };
    messages.push(message);
    renderMessage(message);
    scrollToBottom();
  }

  // Render a message
  function renderMessage(message) {
    const messageEl = document.createElement("div");
    messageEl.className = `ai-chatbot-message ${message.sender}`;
    messageEl.setAttribute("aria-label", `${message.sender === "bot" ? "Bot" : "User"} message: ${message.text}`);
    const sanitizedText = sanitizeHtml(message.text);
    messageEl.innerHTML = sanitizedText;
    elements.messagesArea.appendChild(messageEl);
  }

  // Sanitize HTML with DOMPurify
  function sanitizeHtml(html) {
    return window.DOMPurify ? window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'ul', 'li', 'p'],
      ALLOWED_ATTR: ['href', 'target', 'rel']
    }) : html.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Fallback if DOMPurify not loaded
  }

  // Show typing indicator
  function showTypingIndicator() {
    if (isTyping) return;
    isTyping = true;
    const typingIndicator = document.createElement("div");
    typingIndicator.className = "ai-chatbot-typing";
    typingIndicator.setAttribute("role", "status");
    typingIndicator.setAttribute("aria-label", `${config.botName} is typing`);
    typingIndicator.innerHTML = `
      <span class="ai-chatbot-typing-text">${config.botName} is typing</span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
    `;
    elements.messagesArea.appendChild(typingIndicator);
    scrollToBottom();
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    if (!isTyping) return;
    const typingIndicator = elements.messagesArea.querySelector(".ai-chatbot-typing");
    if (typingIndicator) {
      typingIndicator.remove();
    }
    isTyping = false;
  }

  // Add error message
  function addErrorMessage(errorText, retryQuery = null) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "ai-chatbot-error";
    errorDiv.setAttribute("aria-label", `Error: ${errorText}`);
    errorDiv.textContent = errorText;

    if (retryQuery) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "ai-chatbot-retry";
      retryBtn.textContent = "Retry";
      retryBtn.setAttribute("aria-label", "Retry previous query");
      retryBtn.addEventListener("click", () => {
        errorDiv.remove();
        sendMessage(retryQuery);
      });
      errorDiv.appendChild(retryBtn);
    }

    elements.messagesArea.appendChild(errorDiv);
    scrollToBottom();
  }

  // Display products with price validation
  function displayProducts(products) {
    if (!products || !Array.isArray(products) || products.length === 0) return;

    const productSection = document.createElement("div");
    productSection.className = "ai-chatbot-product-section";

    // Validate prices if query specified a limit
    const priceMatch = lastUserMessage.match(/less than \$?(\d+)/i);
    if (priceMatch) {
      const maxPrice = parseFloat(priceMatch[1]);
      const invalidProducts = products.filter(product => {
        const price = parseFloat(product.price.replace(/[^0-9.]/g, ''));
        return price > maxPrice;
      });
      if (invalidProducts.length > 0) {
        addErrorMessage("Some recommended products exceed your price limit. Please refine your query.");
      }
    }

    products.forEach((product) => {
      if (!product || typeof product !== "object") return;

      const productCard = document.createElement("a");
      productCard.className = "ai-chatbot-product";
      productCard.href = product.url || "#";
      productCard.target = "_blank";
      productCard.rel = "noopener noreferrer";
      productCard.setAttribute("aria-label", `View product: ${product.name || "Product"}`);

      const imageContainer = document.createElement("div");
      imageContainer.className = "ai-chatbot-product-image";

      const img = document.createElement("img");
      img.src = product.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
      img.alt = product.name || "Product";
      img.loading = "lazy"; // Lazy-loading for performance
      imageContainer.appendChild(img);

      const infoDiv = document.createElement("div");
      infoDiv.className = "ai-chatbot-product-info";

      const nameDiv = document.createElement("div");
      nameDiv.className = "ai-chatbot-product-name";
      nameDiv.textContent = product.name || "Product Name";

      const descDiv = document.createElement("div");
      descDiv.className = "ai-chatbot-product-description";
      descDiv.textContent = product.description || "No description available";

      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(descDiv);

      if (product.price) {
        const priceDiv = document.createElement("div");
        priceDiv.className = "ai-chatbot-product-price";
        priceDiv.textContent = product.price;
        infoDiv.appendChild(priceDiv);
      }

      if (product.match_reason) {
        const matchDiv = document.createElement("div");
        matchDiv.className = "ai-chatbot-product-match";
        matchDiv.textContent = product.match_reason;
        infoDiv.appendChild(matchDiv);
      }

      productCard.appendChild(imageContainer);
      productCard.appendChild(infoDiv);
      productSection.appendChild(productCard);
    });

    elements.messagesArea.appendChild(productSection);
    scrollToBottom();
  }

  // Send a message
  function sendMessage(customMessage = null) {
    const message = customMessage || elements.inputField.value.trim();
    if (!message) return;

    const now = Date.now();
    if (now - lastMessageTime < config.rateLimit) {
      addErrorMessage("Please wait a moment before sending another message.");
      return;
    }

    lastMessageTime = now;
    lastUserMessage = message;
    elements.inputField.value = "";
    elements.sendButton.disabled = true;

    // Handle common typos
    const brandCorrections = {
      'omnilix': 'Omnilux',
      'omnulix': 'Omnilux',
    };
    const words = message.toLowerCase().split(/\s+/);
    let correctedMessage = message;
    words.forEach(word => {
      if (brandCorrections[word]) {
        correctedMessage = correctedMessage.replace(new RegExp(word, 'i'), brandCorrections[word]);
      }
    });
    if (correctedMessage !== message) {
      addMessage(`Did you mean "${correctedMessage}"? Searching for that!`, "bot");
    }

    addMessage(message, "user");
    showTypingIndicator();

    const cachedResponse = getCachedResponse(correctedMessage);
    if (cachedResponse) {
      setTimeout(() => {
        hideTypingIndicator();
        handleResponse(cachedResponse);
      }, 500);
      return;
    }

    const history = messages
      .filter((msg) => msg.sender === "user" || msg.sender === "bot")
      .slice(-6)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));

    const url = new URL(config.apiUrl);
    url.searchParams.append("action", "search");
    url.searchParams.append("query", encodeURIComponent(correctedMessage));
    url.searchParams.append("history", encodeURIComponent(JSON.stringify(history)));
    if (config.apiKey) {
      url.searchParams.append("apiKey", config.apiKey);
    }

    const callbackName = `chatbotCallback_${Math.random().toString(36).substring(2, 15)}`;

    window[callbackName] = (data) => {
      hideTypingIndicator();
      if (data.error) {
        addErrorMessage(`Error: ${data.error}`, correctedMessage);
      } else {
        setCachedResponse(correctedMessage, data);
        handleResponse(data);
      }
      if (window[callbackName]) {
        delete window[callbackName];
      }
      if (script && script.parentNode) {
        document.head.removeChild(script);
      }
    };

    const script = document.createElement("script");
    script.src = `${url.toString()}&callback=${callbackName}`;
    script.onerror = () => {
      hideTypingIndicator();
      addErrorMessage("Failed to load response. Please try again.", correctedMessage);
      if (window[callbackName]) {
        delete window[callbackName];
      }
      if (script && script.parentNode) {
        document.head.removeChild(script);
      }
    };
    document.head.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        hideTypingIndicator();
        addErrorMessage("Request timed out. Please try again.", correctedMessage);
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script && script.parentNode) {
          document.head.removeChild(script);
        }
      }
    }, config.apiTimeout);
  }

  // Handle backend response
  function handleResponse(data) {
    if (data.text) {
      addMessage(data.text, "bot");
    }
    if (data.products && Array.isArray(data.products) && data.products.length > 0) {
      lastRecommendedProducts = data.products;
      displayProducts(data.products);
    } else if (data.text.includes("No products found")) {
      addMessage("I couldn't find exact matches. Try simplifying your request (e.g., 'hydrating moisturizer') or let me know your budget!", "bot");
    }
  }

  // Client-side caching
  function getCachedResponse(query) {
    const key = simpleHash(query);
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < config.clientCacheTTL) {
          return data;
        }
        localStorage.removeItem(key); // Remove expired cache
      }
    } catch (err) {
      console.warn("Error accessing localStorage, falling back to in-memory cache:", err);
      const cached = messageCache.get(key);
      if (cached && Date.now() - cached.timestamp < config.clientCacheTTL) {
        return cached.data;
      }
    }
    return null;
  }

  function setCachedResponse(query, data) {
    const key = simpleHash(query);
    const cacheEntry = { data, timestamp: Date.now() };
    
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('pb_h_'));
      if (keys.length >= config.clientCacheSize) {
        const oldestKey = keys.reduce((oldest, k) => {
          const { timestamp } = JSON.parse(localStorage.getItem(k));
          return timestamp < oldest.timestamp ? { key: k, timestamp } : oldest;
        }, { timestamp: Number.POSITIVE_INFINITY }).key;
        localStorage.removeItem(oldestKey);
      }
      localStorage.setItem(key, JSON.stringify(cacheEntry));
    } catch (err) {
      console.warn("Error writing to localStorage, using in-memory cache:", err);
      if (messageCache.size >= config.clientCacheSize) {
        let oldestKey = null;
        let oldestTime = Number.POSITIVE_INFINITY;
        messageCache.forEach((value, key) => {
          if (value.timestamp < oldestTime) {
            oldestTime = value.timestamp;
            oldestKey = key;
          }
        });
        if (oldestKey) {
          messageCache.delete(oldestKey);
        }
      }
      messageCache.set(key, cacheEntry);
    }
  }

  // Simple hash function for cache keys
  function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return "pb_h_0";
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return "pb_h_" + Math.abs(hash).toString(36);
  }

  // Scroll messages to bottom
  function scrollToBottom() {
    elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
  }

  // Get SVG icon
  function getIconSvg(name) {
    const icons = {
      "message-circle": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
      "minimize-2": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      x: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
      sun: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
      moon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
    };
    return icons[name] || icons["message-circle"];
  }

  // Initialize
  function init() {
    injectStyles();
    const els = createWidget();
    return els;
  }

  const elements = init();
})();
