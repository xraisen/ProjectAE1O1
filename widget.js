/**
 * Planet Beauty AI Chatbot Widget
 * Enhanced version with robust JSONP handling, aligned styling with index.html, and improved error handling.
 * Matches color theme and logic to index.html for consistency.
 */

;(() => {
  // Configuration aligned with index.html
  const DEFAULT_CONFIG = {
    apiUrl:
      "https://script.google.com/macros/s/AKfycbys0cIz4SYCFS3h7xue2TFPHBe8RiT94Bbgb0Gg0sg4fJF4OY-NoLUiCfxcvIFuStrS/exec",
    primaryColor: "#e91e63", // --primary
    primaryDark: "#c2185b", // --primary-dark
    textColor: "#ffffff", // White for contrast
    bubbleUserBg: "#e91e63", // --bubble-user-bg
    bubbleBotBg: "#f5f5f5", // --bubble-bot-bg
    cardBgLight: "#ffffff", // --card-bg-light
    borderLight: "#e5e7eb", // --border-light
    matchReasonColorLight: "#666", // --match-reason-color-light
    position: "bottom-right",
    icon: "message-circle",
    welcomeMessage:
      "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
    botName: "Bella",
    apiTimeout: 30000, // 30 seconds
    clientCacheTTL: 3600 * 1000, // 1 hour
    clientCacheSize: 50, // Max cache entries
    rateLimit: 1000, // Minimum time between messages
  };

  // Get configuration from script tag data attributes
  const scriptTag = document.getElementById("ai-chatbot-script");
  const config = {
    ...DEFAULT_CONFIG,
    apiUrl: scriptTag?.getAttribute("data-api-url") || DEFAULT_CONFIG.apiUrl,
    apiKey: scriptTag?.getAttribute("data-api-key") || "",
    primaryColor: scriptTag?.getAttribute("data-primary-color") || DEFAULT_CONFIG.primaryColor,
    primaryDark: scriptTag?.getAttribute("data-primary-dark") || DEFAULT_CONFIG.primaryDark,
    textColor: scriptTag?.getAttribute("data-text-color") || DEFAULT_CONFIG.textColor,
    position: scriptTag?.getAttribute("data-position") || DEFAULT_CONFIG.position,
    welcomeMessage: scriptTag?.getAttribute("data-welcome-message") || DEFAULT_CONFIG.welcomeMessage,
    botName: scriptTag?.getAttribute("data-bot-name") || DEFAULT_CONFIG.botName,
  };

  // State
  let isOpen = false;
  let isTyping = false;
  let lastMessageTime = 0;
  let lastUserMessage = "";
  let lastRecommendedProducts = [];
  const messages = [];

  // Client-side cache
  const messageCache = new Map();

  // Inject styles aligned with index.html
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .ai-chatbot-widget * {
        box-sizing: border-box;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
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
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: ${config.primaryColor};
        color: ${config.textColor};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border: none;
        outline: none;
        transition: transform 0.2s ease, background-color 0.3s;
      }
      .ai-chatbot-toggle:hover {
        background-color: ${config.primaryDark};
        transform: scale(1.05);
      }
      .ai-chatbot-toggle svg {
        width: 28px;
        height: 28px;
      }
      .ai-chatbot-container {
        position: absolute;
        bottom: 70px;
        width: 350px;
        height: 500px;
        background: ${config.cardBgLight};
        border-radius: 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.3s ease;
        opacity: 0;
        transform: translateY(20px) scale(0.9);
        pointer-events: none;
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
        background: linear-gradient(to right, ${config.primaryColor}, ${config.primaryDark});
        color: ${config.textColor};
        padding: 0.75rem 1rem;
        border-top-left-radius: 16px;
        border-top-right-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 600;
      }
      .ai-chatbot-header-title {
        display: flex;
        align-items: center;
      }
      .ai-chatbot-header-title svg {
        margin-right: 8px;
        width: 20px;
        height: 20px;
      }
      .ai-chatbot-header-actions {
        display: flex;
      }
      .ai-chatbot-header-button {
        background: transparent;
        border: none;
        color: ${config.textColor};
        cursor: pointer;
        padding: 5px;
        margin-left: 5px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
      }
      .ai-chatbot-header-button:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .ai-chatbot-header-button svg {
        width: 16px;
        height: 16px;
      }
      .ai-chatbot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        scroll-behavior: smooth;
      }
      .ai-chatbot-message {
        padding: 0.8rem 1.2rem;
        border-radius: 16px;
        max-width: 80%;
        font-size: 0.95rem;
        line-height: 1.5;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        animation: fadeIn 0.5s ease-out forwards;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .ai-chatbot-message.bot {
        align-self: flex-start;
        background-color: ${config.bubbleBotBg};
        color: #000000;
        border-bottom-left-radius: 4px;
      }
      .ai-chatbot-message.user {
        align-self: flex-end;
        background-color: ${config.bubbleUserBg};
        color: ${config.textColor};
        border-bottom-right-radius: 4px;
      }
      .ai-chatbot-product-section {
        background: #f9f9f9;
        padding: 0.75rem;
        border-radius: 12px;
        margin-bottom: 0.75rem;
        max-width: 95%;
        margin-right: auto;
        animation: fadeIn 0.5s ease-out forwards;
      }
      .ai-chatbot-product {
        display: flex;
        align-items: center;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
        transition: transform 0.2s, box-shadow 0.2s;
        margin: 0.5rem 0;
        text-decoration: none;
        color: inherit;
        background: ${config.cardBgLight};
        max-width: 100%;
        cursor: pointer;
        border: 1px solid ${config.borderLight};
      }
      .ai-chatbot-product:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.12);
      }
      .ai-chatbot-product-image {
        width: 80px;
        height: 80px;
        flex-shrink: 0;
        margin: 0.5rem;
        border-radius: 8px;
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
        padding: 0.5rem 0.75rem;
        flex: 1;
        min-width: 0;
      }
      .ai-chatbot-product-name {
        font-weight: 600;
        font-size: 0.9rem;
        margin-bottom: 0.2rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ai-chatbot-product-description {
        font-size: 0.8rem;
        color: #555;
        margin-bottom: 0.25rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: 2.4em;
      }
      .ai-chatbot-product-price {
        font-weight: 600;
        font-size: 0.85rem;
        color: ${config.primaryColor};
      }
      .ai-chatbot-product-match {
        font-size: 0.7rem;
        color: ${config.matchReasonColorLight};
        margin-top: 0.1rem;
        font-style: italic;
      }
      .ai-chatbot-typing {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.8rem 1.2rem;
        border-radius: 16px;
        max-width: 80%;
        align-self: flex-start;
        background-color: ${config.bubbleBotBg};
        border-bottom-left-radius: 4px;
        animation: fadeIn 0.5s ease-out forwards;
      }
      .ai-chatbot-typing-text {
        font-size: 0.85rem;
        opacity: 0.7;
      }
      .ai-chatbot-typing-dot {
        width: 7px;
        height: 7px;
        background: ${config.primaryColor};
        border-radius: 50%;
        display: inline-block;
      }
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }
      .ai-chatbot-typing-dot:nth-child(1) { animation: bounce 0.6s infinite ease-in-out; }
      .ai-chatbot-typing-dot:nth-child(2) { animation: bounce 0.6s infinite 0.1s ease-in-out; }
      .ai-chatbot-typing-dot:nth-child(3) { animation: bouncedal 0.6s infinite 0.2s ease-in-out; }
      .ai-chatbot-suggested-questions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.75rem 0;
        max-width: 95%;
        animation: fadeIn 0.5s ease-out forwards;
      }
      .ai-chatbot-suggested-question {
        background: ${config.bubbleBotBg};
        border: 1px solid ${config.primaryColor};
        border-radius: 20px;
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .ai-chatbot-suggested-question:hover {
        background: ${config.primaryColor};
        color: ${config.textColor};
        transform: scale(1.05);
      }
      .ai-chatbot-input {
        padding: 0.75rem;
        border-top: 1px solid ${config.borderLight};
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .ai-chatbot-input-field {
        flex: 1;
        border: 1px solid ${config.primaryColor};
        border-radius: 8px;
        padding: 10px;
        font-size: 0.95rem;
        outline: none;
        transition: border-color 0.3s;
        background: #f9f9f9;
      }
      .ai-chatbot-input-field:focus {
        border-color: ${config.primaryDark};
        box-shadow: 0 0 5px rgba(233, 30手段: 0.3s;
      }
      .ai-chatbot-send-button {
        background-color: ${config.primaryColor};
        color: ${config.textColor};
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background-color 0.3s, transform 0.2s;
      }
      .ai-chatbot-send-button:hover {
        background-color: ${config.primaryDark};
        transform: scale(1.1);
      }
      .ai-chatbot-send-button:disabled {
        background-color: #d1d5db;
        cursor: not-allowed;
        transform: none;
      }
      .ai-chatbot-send-button svg {
        width: 18px;
        height: 18px;
      }
      .ai-chatbot-error {
        background: #fef2f2;
        color: #dc2626;
        padding: 0.6rem 1rem;
        border-radius: 12px;
        max-width: 80%;
        align-self: flex-start;
        border: 1px solid #fecaca;
        font-size: 0.85rem;
        margin-bottom: 0.75rem;
        animation: fadeIn 0.5s ease-out forwards;
      }
      .ai-chatbot-retry {
        background: none;
        border: none;
        color: ${config.primaryColor};
        text-decoration: underline;
        cursor: pointer;
        font-size: 0.85rem;
        margin-left: 0.5rem;
        font-weight: 500;
      }
      @media (max-width: 480px) {
        .ai-chatbot-container {
          width: calc(100vw - 40px);
          height: 60vh;
          max-height: 500px;
        }
        .ai-chatbot-widget.bottom-right .ai-chatbot-container,
        .ai-chatbot-widget.bottom-left .ai-chatbot-container {
          left: 50%;
          right: auto;
          transform: translateX(-50%) translateY(20px) scale(0.9);
        }
        .ai-chatbot-widget.open .ai-chatbot-container {
          transform: translateX(-50%) translateY(0) scale(1);
        }
        .ai-chatbot-product-image {
          width: 60px;
          height: 60px;
          margin: 0.4rem;
        }
        .ai-chatbot-product-name {
          font-size: 0.85rem;
        }
        .ai-chatbot-product-description {
          font-size: 0.75rem;
          min-height: 2.25em;
        }
        .ai-chatbot-product-price,
        .ai-chatbot-product-match {
          font-size: 0.8rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Create widget DOM
  function createWidget() {
    const widget = document.createElement("div");
    widget.className = `ai-chatbot-widget ${config.position}`;

    // Toggle button
    const toggle = document.createElement("button");
    toggle.className = "ai-chatbot-toggle";
    toggle.setAttribute("aria-label", "Open chat");
    toggle.innerHTML = getIconSvg(config.icon);
    toggle.addEventListener("click", toggleChat);

    // Chat container
    const container = document.createElement("div");
    container.className = "ai-chatbot-container";

    // Header
    const header = document.createElement("div");
    header.className = "ai-chatbot-header";

    const headerTitle = document.createElement("div");
    headerTitle.className = "ai-chatbot-header-title";
    headerTitle.innerHTML = `${getIconSvg("message-circle")} <span>Beauty Assistant</span>`;

    const headerActions = document.createElement("div");
    headerActions.className = "ai-chatbot-header-actions";

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

    headerActions.appendChild(minimizeButton);
    headerActions.appendChild(closeButton);

    header.appendChild(headerTitle);
    header.appendChild(headerActions);

    // Messages area
    const messagesArea = document.createElement("div");
    messagesArea.className = "ai-chatbot-messages";

    // Input area
    const inputArea = document.createElement("div");
    inputArea.className = "ai-chatbot-input";

    const inputField = document.createElement("input");
    inputField.className = "ai-chatbot-input-field";
    inputField.type = "text";
    inputField.placeholder = "Ask about products or beauty tips...";
    inputField.setAttribute("aria-label", "Type your beauty question or search products");
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

    // Assemble container
    container.appendChild(header);
    container.appendChild(messagesArea);
    container.appendChild(inputArea);

    // Assemble widget
    widget.appendChild(toggle);
    widget.appendChild(container);

    document.body.appendChild(widget);

    // Fetch initial data
    fetchInitialData();

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
    const callbackName = `chatbotInitCallback_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    let script;

    try {
      const url = new URL(config.apiUrl);
      url.searchParams.append("action", "get_initial_data");
      if (config.apiKey) {
        url.searchParams.append("apiKey", config.apiKey);
      }
      url.searchParams.append("callback", callbackName);

      // Define callback before appending script
      window[callbackName] = (data) => {
        try {
          if (data.error) {
            addErrorMessage(`Error loading initial data: ${data.error}`);
            addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
          } else {
            addMessage(data.welcomeMessage || config.welcomeMessage, "bot");
            if (data.suggestedQuestions?.length > 0) {
              addSuggestedQuestions(data.suggestedQuestions);
            }
          }
        } catch (error) {
          console.error("Error processing initial data:", error);
          addErrorMessage("Failed to load initial data. Please try again.");
        } finally {
          cleanup();
        }
      };

      script = document.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        console.error("Failed to load initial data script.");
        addErrorMessage("Network error loading initial data.");
        addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
        cleanup();
      };
      document.head.appendChild(script);

      // Timeout
      setTimeout(() => {
        if (window[callbackName]) {
          addErrorMessage("Initial data request timed out.");
          addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
          cleanup();
        }
      }, config.apiTimeout);

      function cleanup() {
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script?.parentNode) {
          script.parentNode.removeChild(script);
        }
      }
    } catch (error) {
      console.error("Error fetching initial data:", error);
      addErrorMessage("Error initializing chatbot.");
      addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
      if (script?.parentNode) {
        script.parentNode.removeChild(script);
      }
    }
  }

  // Add suggested questions
  function addSuggestedQuestions(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return;

    const container = document.createElement("div");
    container.className = "ai-chatbot-suggested-questions";

    questions.forEach((question) => {
      if (typeof question !== "string" || !question.trim()) return;
      const button = document.createElement("button");
      button.className = "ai-chatbot-suggested-question";
      button.textContent = sanitizeText(question);
      button.setAttribute("aria-label", `Ask: ${sanitizeText(question)}`);
      button.addEventListener("click", () => {
        elements.inputField.value = question;
        sendMessage();
      });
      container.appendChild(button);
    });

    elements.messagesArea.appendChild(container);
    scrollToBottom();
  }

  // Toggle chat
  function toggleChat() {
    isOpen = !isOpen;
    elements.widget.classList.toggle("open", isOpen);
    if (isOpen) {
      elements.inputField.focus();
    }
  }

  // Add message
  function addMessage(text, sender) {
    const message = { text, sender, timestamp: new Date() };
    messages.push(message);
    renderMessage(message);
    scrollToBottom();
  }

  // Render message
  function renderMessage(message) {
    const messageEl = document.createElement("div");
    messageEl.className = `ai-chatbot-message ${message.sender} chat-content-message`;
    messageEl.innerHTML = `<span class="message-content">${sanitizeHtml(message.text)}</span>`;
    elements.messagesArea.appendChild(messageEl);
  }

  // Sanitize HTML (aligned with index.html)
  function sanitizeHtml(html) {
    if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) {
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ALLOWED_TAGS: ["b", "i", "strong", "em", "br", "p", "ul", "ol", "li"],
      });
    }
    console.warn("DOMPurify not loaded, using fallback sanitization.");
    return sanitizeTextFallback(html);
  }

  function sanitizeText(text) {
    if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) {
      return DOMPurify.sanitize(text, { USE_PROFILES: { html: false } });
    }
    return sanitizeTextFallback(text);
  }

  function sanitizeTextFallback(text) {
    const tempDiv = document.createElement("div");
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  // Show typing indicator
  function showTypingIndicator() {
    if (isTyping) return;
    isTyping = true;

    const typingIndicator = document.createElement("div");
    typingIndicator.className = "ai-chatbot-typing";
    typingIndicator.id = "typing-indicator";
    typingIndicator.setAttribute("role", "status");
    typingIndicator.setAttribute("aria-live", "polite");
    typingIndicator.innerHTML = `
      <span class="ai-chatbot-typing-text" aria-hidden="true">${config.botName} is typing</span>
      <span class="ai-chatbot-typing-dot" aria-hidden="true"></span>
      <span class="ai-chatbot-typing-dot" aria-hidden="true"></span>
      <span class="ai-chatbot-typing-dot" aria-hidden="true"></span>
    `;
    elements.messagesArea.appendChild(typingIndicator);
    scrollToBottom();
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    if (!isTyping) return;
    const typingIndicator = elements.messagesArea.querySelector("#typing-indicator");
    if (typingIndicator) {
      typingIndicator.remove();
    }
    isTyping = false;
  }

  // Add error message
  function addErrorMessage(errorText, retryQuery = null) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "ai-chatbot-error animate-fade-in";
    errorDiv.textContent = sanitizeText(errorText);

    if (retryQuery) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "ai-chatbot-retry";
      retryBtn.textContent = "Retry";
      retryBtn.setAttribute("aria-label", "Retry sending the last message");
      retryBtn.addEventListener("click", () => {
        errorDiv.remove();
        sendMessage(retryQuery);
      });
      errorDiv.appendChild(retryBtn);
    }

    elements.messagesArea.appendChild(errorDiv);
    scrollToBottom();
  }

  // Display products
  function displayProducts(products) {
    if (!Array.isArray(products) || products.length === 0) return;

    const productSection = document.createElement("div");
    productSection.className = "ai-chatbot-product-section animate-fade-in";

    products.forEach((product) => {
      if (!product || typeof product !== "object") return;

      const productCard = document.createElement("a");
      productCard.className = "ai-chatbot-product";
      productCard.href = sanitizeText(product.url || "#");
      productCard.target = "_blank";
      productCard.rel = "noopener noreferrer";
      productCard.setAttribute("aria-label", `View product: ${sanitizeText(product.name || "Unnamed Product")}`);

      const imageContainer = document.createElement("div");
      imageContainer.className = "ai-chatbot-product-image";

      const img = document.createElement("img");
      img.src = sanitizeText(
        product.image ||
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E'
      );
      img.alt = sanitizeText(product.name || "Product image");
      img.setAttribute("loading", "lazy");
      imageContainer.appendChild(img);

      const infoDiv = document.createElement("div");
      infoDiv.className = "ai-chatbot-product-info";
      infoDiv.innerHTML = `
        <div class="ai-chatbot-product-name">${sanitizeText(product.name || "Unnamed Product")}</div>
        <div class="ai-chatbot-product-description">${sanitizeText(product.description || "No description available.")}</div>
        ${product.price ? `<div class="ai-chatbot-product-price">${sanitizeText(product.price)}</div>` : ""}
        ${product.match_reason ? `<div class="ai-chatbot-product-match">${sanitizeText(product.match_reason)}</div>` : ""}
      `;

      productCard.appendChild(imageContainer);
      productCard.appendChild(infoDiv);
      productSection.appendChild(productCard);
    });

    elements.messagesArea.appendChild(productSection);
    scrollToBottom();
  }

  // Send message
  function sendMessage(customMessage = null) {
    const message = customMessage || elements.inputField.value.trim();
    if (!message) return;

    const now = Date.now();
    if (now - lastMessageTime < config.rateLimit) {
      addErrorMessage(`Please wait ${Math.ceil((config.rateLimit - (now - lastMessageTime)) / 1000)}s before sending.`);
      return;
    }

    lastMessageTime = now;
    lastUserMessage = message;
    elements.inputField.value = "";
    elements.sendButton.disabled = true;

    addMessage(message, "user");
    showTypingIndicator();

    // Check cache
    const cachedResponse = getCachedResponse(message);
    if (cachedResponse) {
      setTimeout(() => {
        hideTypingIndicator();
        handleResponse(cachedResponse);
      }, 500);
      return;
    }

    // Prepare request
    const history = messages
      .filter((msg) => msg.sender === "user" || msg.sender === "bot")
      .slice(-6)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));

    const callbackName = `chatbotCallback_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    let script;

    try {
      const url = new URL(config.apiUrl);
      url.searchParams.append("action", "search");
      url.searchParams.append("query", encodeURIComponent(message));
      url.searchParams.append("conversationHistory", encodeURIComponent(JSON.stringify(history)));
      if (config.apiKey) {
        url.searchParams.append("apiKey", config.apiKey);
      }
      url.searchParams.append("callback", callbackName);

      window[callbackName] = (data) => {
        try {
          hideTypingIndicator();
          if (data.error) {
            addErrorMessage(`Assistant error: ${sanitizeText(data.error)}`, message);
          } else {
            setCachedResponse(message, data);
            handleResponse(data);
          }
        } catch (error) {
          console.error("Error processing response:", error);
          addErrorMessage("Error processing response.", message);
        } finally {
          cleanup();
        }
      };

      script = document.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        console.error("Failed to load response script.");
        hideTypingIndicator();
        addErrorMessage("Network error sending message.", message);
        cleanup();
      };
      document.head.appendChild(script);

      setTimeout(() => {
        if (window[callbackName]) {
          hideTypingIndicator();
          addErrorMessage("Request timed out.", message);
          cleanup();
        }
      }, config.apiTimeout);

      function cleanup() {
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script?.parentNode) {
          script.parentNode.removeChild(script);
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      hideTypingIndicator();
      addErrorMessage(`Error: ${error.message}`, message);
      if (script?.parentNode) {
        script.parentNode.removeChild(script);
      }
    }
  }

  // Handle response
  function handleResponse(data) {
    if (data.text) {
      addMessage(data.text, "bot");
    }
    if (data.products?.length > 0) {
      lastRecommendedProducts = data.products;
      displayProducts(data.products);
    } else {
      lastRecommendedProducts = [];
    }
  }

  // Client-side caching
  function getCachedResponse(query) {
    const key = simpleHash(query);
    const cached = messageCache.get(key);
    if (cached && Date.now() - cached.timestamp < config.clientCacheTTL) {
      return cached.data;
    }
    return null;
  }

  function setCachedResponse(query, data) {
    const key = simpleHash(query);
    if (messageCache.size >= config.clientCacheSize) {
      let oldestKey = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      messageCache.forEach((value, k) => {
        if (value.timestamp < oldestTime) {
          oldestTime = value.timestamp;
          oldestKey = k;
        }
      });
      if (oldestKey) {
        messageCache.delete(oldestKey);
      }
    }
    messageCache.set(key, { data, timestamp: Date.now() });
  }

  // Simple hash
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

  // Scroll to bottom
  function scrollToBottom() {
    if ("scrollBehavior" in document.documentElement.style) {
      elements.messagesArea.scrollTo({ top: elements.messagesArea.scrollHeight, behavior: "smooth" });
    } else {
      elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
    }
  }

  // Get SVG icon
  function getIconSvg(name) {
    const icons = {
      "message-circle":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
      "minimize-2":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      x: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
    };
    return icons[name] || icons["message-circle"];
  }

  // Initialize
  function init() {
    if (!document.getElementById("ai-chatbot-script")) {
      console.warn("Chatbot script tag not found.");
    }
    injectStyles();
    const els = createWidget();
    return els;
  }

  const elements = init();
})();
