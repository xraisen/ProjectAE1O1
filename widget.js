/**
 * Planet Beauty AI Chatbot Widget
 * This script creates and manages the chatbot widget that appears on your Shopify store.
 * Enhanced version with improved UI, typing indicators, and better interactions.
 * v2: Fixed JSONP callback race condition.
 */

;(() => {
  // Configuration
  const DEFAULT_CONFIG = {
    apiUrl:
      "https://script.google.com/macros/s/AKfycbwxBPdBePvHxJLHzCiFEZaZupmtEepcAIZoTkJYEvELIiGRn6TFGuVedkKdzDyTa6YN/exec", // Google Apps Script URL
    primaryColor: "#e91e63",
    textColor: "#ffffff",
    position: "bottom-right",
    icon: "message-circle",
    welcomeMessage:
      "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
    botName: "Bella", // Name of the AI assistant
    apiTimeout: 30000, // 30 seconds timeout for API calls
    clientCacheTTL: 3600 * 1000, // 1 hour in milliseconds
    clientCacheSize: 50, // Max number of cached responses
    rateLimit: 1000, // Minimum time between messages in ms
  }

  // Get configuration from script tag data attributes
  const scriptTag = document.getElementById("ai-chatbot-script")
  const config = {
    ...DEFAULT_CONFIG,
    apiUrl: scriptTag?.getAttribute("data-api-url") || DEFAULT_CONFIG.apiUrl,
    apiKey: scriptTag?.getAttribute("data-api-key") || "", // Added apiKey reading
    primaryColor: scriptTag?.getAttribute("data-primary-color") || DEFAULT_CONFIG.primaryColor,
    textColor: scriptTag?.getAttribute("data-text-color") || DEFAULT_CONFIG.textColor,
    position: scriptTag?.getAttribute("data-position") || DEFAULT_CONFIG.position,
    welcomeMessage: scriptTag?.getAttribute("data-welcome-message") || DEFAULT_CONFIG.welcomeMessage,
    botName: scriptTag?.getAttribute("data-bot-name") || DEFAULT_CONFIG.botName,
  }

  // State
  let isOpen = false
  const messages = []
  let isTyping = false
  let lastMessageTime = 0
  let lastUserMessage = ""
  let lastRecommendedProducts = []

  // Client-side cache
  const messageCache = new Map()

  // Create and inject styles
  function injectStyles() {
    const style = document.createElement("style")
    // --- Style content remains the same as your original, using config values ---
    // (Ensure all instances of config.primaryColor, config.textColor etc. are correct)
    style.textContent = `
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
        transition: transform 0.2s ease;
      }

      .ai-chatbot-toggle:hover {
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
        background: white;
        border-radius: 12px;
        box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2);
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
        background: linear-gradient(to right, ${config.primaryColor}, ${adjustColor(config.primaryColor, -20)});
        color: ${config.textColor};
        padding: 15px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .ai-chatbot-header-title {
        display: flex;
        align-items: center;
        font-weight: 600;
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
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scroll-behavior: smooth;
      }

      .ai-chatbot-message {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 18px;
        font-size: 14px;
        line-height: 1.4;
        animation: fadeIn 0.3s ease-out forwards;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ai-chatbot-message.bot {
        align-self: flex-start;
        background-color: #f5f5f5;
        border-bottom-left-radius: 4px;
      }

      .ai-chatbot-message.user {
        align-self: flex-end;
        background-color: ${config.primaryColor};
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
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        transition: transform 0.2s, box-shadow 0.2s;
        margin: 0.5rem 0;
        text-decoration: none;
        color: inherit;
        background: white;
        max-width: 100%;
        cursor: pointer;
        border: 1px solid #e5e7eb;
      }

      .ai-chatbot-product:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.12);
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
        padding: 8px;
        flex: 1;
        min-width: 0;
      }

      .ai-chatbot-product-name {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ai-chatbot-product-description {
        font-size: 12px;
        color: #666;
        margin: 3px 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .ai-chatbot-product-price {
        font-weight: 600;
        color: ${config.primaryColor};
        font-size: 13px;
      }

      .ai-chatbot-product-match {
        font-size: 0.7rem;
        color: #777;
        margin-top: 0.1rem;
        font-style: italic;
      }

      .ai-chatbot-typing {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 10px 14px;
        border-radius: 18px;
        font-size: 14px;
        max-width: 80%;
        align-self: flex-start;
        background-color: #f5f5f5;
        border-bottom-left-radius: 4px;
        animation: fadeIn 0.3s ease-out forwards;
      }

      .ai-chatbot-typing-text {
        font-size: 0.85rem;
        opacity: 0.7;
        margin-right: 5px; /* Added margin */
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

      .ai-chatbot-typing-dot:nth-child(2) { animation: bounce 0.6s infinite ease-in-out; } /* Adjusted index */
      .ai-chatbot-typing-dot:nth-child(3) { animation: bounce 0.6s infinite 0.1s ease-in-out; } /* Adjusted index */
      .ai-chatbot-typing-dot:nth-child(4) { animation: bounce 0.6s infinite 0.2s ease-in-out; } /* Adjusted index */

      .ai-chatbot-suggested-questions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        margin-bottom: 10px;
        max-width: 95%;
        animation: fadeIn 0.5s ease-out forwards;
      }

      .ai-chatbot-suggested-question {
        background-color: #f5f5f5;
        border: 1px solid ${config.primaryColor};
        border-radius: 20px;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .ai-chatbot-suggested-question:hover {
        background: ${config.primaryColor};
        color: white;
        transform: scale(1.05);
      }

      .ai-chatbot-input {
        padding: 15px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
      }

      .ai-chatbot-input-field {
        flex: 1;
        border: 1px solid #e0e0e0;
        border-radius: 20px;
        padding: 8px 15px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }

      .ai-chatbot-input-field:focus {
        border-color: ${config.primaryColor};
      }

      .ai-chatbot-send-button {
        background-color: ${config.primaryColor};
        color: ${config.textColor};
        border: none;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        margin-left: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s;
      }

      .ai-chatbot-send-button:hover {
        transform: scale(1.05);
      }

      .ai-chatbot-send-button:disabled {
        background-color: #cccccc;
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
        padding: 10px 14px;
        border-radius: 18px;
        font-size: 14px;
        max-width: 80%;
        align-self: flex-start;
        border-bottom-left-radius: 4px;
        margin-bottom: 10px;
        border: 1px solid #fecaca;
        animation: fadeIn 0.3s ease-out forwards;
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
        }
      }
    `
    document.head.appendChild(style)
  }

  // Helper function to adjust color brightness
  function adjustColor(hex, percent) {
    try {
      let r = Number.parseInt(hex.substring(1, 3), 16)
      let g = Number.parseInt(hex.substring(3, 5), 16)
      let b = Number.parseInt(hex.substring(5, 7), 16)

      r = Math.round(Math.max(0, Math.min(255, r * (1 + percent / 100))))
      g = Math.round(Math.max(0, Math.min(255, g * (1 + percent / 100))))
      b = Math.round(Math.max(0, Math.min(255, b * (1 + percent / 100))))

      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0');
    } catch (e) {
      console.error("Error adjusting color:", hex, e);
      return hex; // Return original color on error
    }
  }


  // Create widget DOM
  function createWidget() {
    const widget = document.createElement("div")
    widget.className = `ai-chatbot-widget ${config.position}`

    // Toggle button
    const toggle = document.createElement("button")
    toggle.className = "ai-chatbot-toggle"
    toggle.setAttribute("aria-label", "Open chat")
    toggle.innerHTML = getIconSvg(config.icon)
    toggle.addEventListener("click", toggleChat)

    // Chat container
    const container = document.createElement("div")
    container.className = "ai-chatbot-container"

    // Header
    const header = document.createElement("div")
    header.className = "ai-chatbot-header"

    const headerTitle = document.createElement("div")
    headerTitle.className = "ai-chatbot-header-title"
    // Use config.botName for the title
    headerTitle.innerHTML = `${getIconSvg("message-circle")} <span>${config.botName} Assistant</span>`

    const headerActions = document.createElement("div")
    headerActions.className = "ai-chatbot-header-actions"

    const minimizeButton = document.createElement("button")
    minimizeButton.className = "ai-chatbot-header-button"
    minimizeButton.setAttribute("aria-label", "Minimize chat")
    minimizeButton.innerHTML = getIconSvg("minimize-2")
    minimizeButton.addEventListener("click", toggleChat)

    const closeButton = document.createElement("button")
    closeButton.className = "ai-chatbot-header-button"
    closeButton.setAttribute("aria-label", "Close chat")
    closeButton.innerHTML = getIconSvg("x")
    closeButton.addEventListener("click", toggleChat)

    headerActions.appendChild(minimizeButton)
    headerActions.appendChild(closeButton)

    header.appendChild(headerTitle)
    header.appendChild(headerActions)

    // Messages area
    const messagesArea = document.createElement("div")
    messagesArea.className = "ai-chatbot-messages"

    // Input area
    const inputArea = document.createElement("div")
    inputArea.className = "ai-chatbot-input"

    const inputField = document.createElement("input")
    inputField.className = "ai-chatbot-input-field"
    inputField.type = "text"
    inputField.placeholder = "Type your message..."
    inputField.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !sendButton.disabled) {
        sendMessage()
      }
    })
    inputField.addEventListener("input", () => {
      sendButton.disabled = !inputField.value.trim()
    })

    const sendButton = document.createElement("button")
    sendButton.className = "ai-chatbot-send-button"
    sendButton.setAttribute("aria-label", "Send message")
    sendButton.innerHTML = getIconSvg("send")
    sendButton.disabled = true
    sendButton.addEventListener("click", sendMessage)

    inputArea.appendChild(inputField)
    inputArea.appendChild(sendButton)

    // Assemble container
    container.appendChild(header)
    container.appendChild(messagesArea)
    container.appendChild(inputArea)

    // Assemble widget
    widget.appendChild(toggle)
    widget.appendChild(container)

    document.body.appendChild(widget)

    // Fetch initial data AFTER elements are created
    fetchInitialData()

    return {
      widget,
      toggle,
      container,
      messagesArea,
      inputField,
      sendButton,
    }
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
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        // Remove the global callback function
        if (window[callbackName]) {
            try {
                delete window[callbackName];
            } catch (e) {
                window[callbackName] = undefined; // Fallback for older browsers
            }
        }
        // Remove the script tag
        if (script && script.parentNode) {
            script.parentNode.removeChild(script);
            script = null; // Help garbage collection
        }
    };

    // Define the global callback function
    window[callbackName] = (data) => {
        if (completed) return; // Prevent double execution
        completed = true;
        cleanup();
        successCallback(data);
    };

    // Handle script loading errors
    script.onerror = () => {
        if (completed) return; // Prevent double execution
        completed = true;
        console.error("JSONP request failed to load script:", url.toString());
        cleanup();
        errorCallback("Script load error.");
    };

    // Set timeout
    timeoutId = setTimeout(() => {
        if (completed) return; // Prevent double execution
        completed = true;
        console.warn("JSONP request timed out:", url.toString());
        cleanup();
        errorCallback("Request timed out.");
    }, timeoutDuration);

    // Append script to start the request
    script.src = url.toString();
    document.head.appendChild(script);
  }


  // Fetch initial welcome message and suggested questions
  function fetchInitialData() {
    try {
      const params = { action: "get_initial_data" };
      if (config.apiKey) {
        params.apiKey = config.apiKey;
      }

      makeJsonpRequest(
        config.apiUrl,
        params,
        "chatbotInitCallback_",
        config.apiTimeout,
        // Success Callback
        (data) => {
          if (data.error) {
            console.error("Error fetching initial data (from response):", data.error);
            addMessage(config.welcomeMessage, "bot"); // Use configured welcome message
          } else {
            addMessage(data.welcomeMessage || config.welcomeMessage, "bot");
            if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
              addSuggestedQuestions(data.suggestedQuestions);
            }
          }
        },
        // Error Callback (timeout or script load error)
        (errorMsg) => {
          console.error("Error fetching initial data (network/timeout):", errorMsg);
          addMessage(config.welcomeMessage, "bot"); // Fallback welcome message
        }
      );
    } catch (error) {
      console.error("Error setting up initial data fetch:", error);
      addMessage(config.welcomeMessage, "bot"); // Fallback welcome message
    }
  }

  // Add suggested questions to the chat
  function addSuggestedQuestions(questions) {
    if (!questions || !Array.isArray(questions) || questions.length === 0) return

    const suggestedQuestionsContainer = document.createElement("div")
    suggestedQuestionsContainer.className = "ai-chatbot-suggested-questions"

    questions.forEach((question) => {
      const questionButton = document.createElement("button")
      questionButton.className = "ai-chatbot-suggested-question"
      questionButton.textContent = question
      questionButton.addEventListener("click", () => {
        // Ensure elements are available before accessing
        if (elements && elements.inputField) {
            elements.inputField.value = question;
            elements.sendButton.disabled = false; // Enable send button
            sendMessage(); // Send the message directly
        } else {
            console.error("Chat elements not ready for suggested question.");
        }
      })
      suggestedQuestionsContainer.appendChild(questionButton)
    })

    // Ensure elements are available before appending
    if (elements && elements.messagesArea) {
        elements.messagesArea.appendChild(suggestedQuestionsContainer)
        scrollToBottom()
    } else {
         console.error("Messages area not ready for suggested questions.");
    }
  }

  // Toggle chat open/closed
  function toggleChat() {
    isOpen = !isOpen
    elements.widget.classList.toggle("open", isOpen)

    if (isOpen && elements.inputField) {
      elements.inputField.focus()
    }
  }

  // Add a message to the chat
  function addMessage(text, sender) {
    const message = {
      text,
      sender,
      timestamp: new Date(),
    }

    messages.push(message)
    renderMessage(message)
    scrollToBottom()
  }

  // Render a message in the chat
  function renderMessage(message) {
    // Ensure elements are ready
    if (!elements || !elements.messagesArea) {
        console.error("Cannot render message, elements not ready.");
        return;
    }
    const messageEl = document.createElement("div")
    messageEl.className = `ai-chatbot-message ${message.sender}`

    // Sanitize HTML content before setting innerHTML
    const sanitizedText = sanitizeHtml(message.text)
    messageEl.innerHTML = sanitizedText

    elements.messagesArea.appendChild(messageEl)
  }

  // Basic HTML Sanitizer (Replace with a robust library like DOMPurify if complex HTML is expected)
  function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    // Basic sanitization: escape HTML tags
    const tempDiv = document.createElement("div");
    tempDiv.textContent = html; // Use textContent to escape HTML entities
    // Allow basic formatting tags if needed (be cautious)
    let sanitized = tempDiv.innerHTML;
    // Example: Allow <b>, <i>, <br>, <ul>, <li> (Adjust as needed)
    sanitized = sanitized.replace(/<b>/g, '<b>').replace(/<\/b>/g, '</b>');
    sanitized = sanitized.replace(/<i>/g, '<i>').replace(/<\/i>/g, '</i>');
    sanitized = sanitized.replace(/<br\s*\/?>/g, '<br>');
    sanitized = sanitized.replace(/<ul>/g, '<ul>').replace(/<\/ul>/g, '</ul>');
    sanitized = sanitized.replace(/<li>/g, '<li>').replace(/<\/li>/g, '</li>');
    // Add more replacements carefully if required

    return sanitized;
  }

  // Show typing indicator
  function showTypingIndicator() {
    if (isTyping || !elements || !elements.messagesArea) return

    isTyping = true

    const typingIndicator = document.createElement("div")
    typingIndicator.className = "ai-chatbot-typing"
    typingIndicator.setAttribute("role", "status")
    typingIndicator.setAttribute("aria-live", "polite")
    // Use config.botName in the typing indicator
    typingIndicator.innerHTML = `
      <span class="ai-chatbot-typing-text">${config.botName} is typing</span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
      <span class="ai-chatbot-typing-dot"></span>
    `

    elements.messagesArea.appendChild(typingIndicator)
    scrollToBottom()
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    if (!isTyping || !elements || !elements.messagesArea) return

    const typingIndicator = elements.messagesArea.querySelector(".ai-chatbot-typing")
    if (typingIndicator) {
      typingIndicator.remove()
    }

    isTyping = false
  }

  // Add error message
  function addErrorMessage(errorText, retryQuery = null) {
     // Ensure elements are ready
    if (!elements || !elements.messagesArea) {
        console.error("Cannot add error message, elements not ready.");
        return;
    }
    const errorDiv = document.createElement("div")
    errorDiv.className = "ai-chatbot-error"
    errorDiv.textContent = errorText // Display plain text error

    if (retryQuery) {
      const retryBtn = document.createElement("button")
      retryBtn.className = "ai-chatbot-retry"
      retryBtn.textContent = "Retry"
      retryBtn.addEventListener("click", () => {
        errorDiv.remove()
        sendMessage(retryQuery) // Retry the original message
      })
      errorDiv.appendChild(retryBtn)
    }

    elements.messagesArea.appendChild(errorDiv)
    scrollToBottom()
  }

  // Display products
  function displayProducts(products) {
    if (!products || !Array.isArray(products) || products.length === 0 || !elements || !elements.messagesArea) return

    const productSection = document.createElement("div")
    productSection.className = "ai-chatbot-product-section"

    products.forEach((product) => {
      if (!product || typeof product !== "object") return

      const productCard = document.createElement("a")
      productCard.className = "ai-chatbot-product"
      // Sanitize URL before assigning
      productCard.href = sanitizeHtml(product.url || '#') // Basic sanitize URL
      productCard.target = "_blank"
      productCard.rel = "noopener noreferrer"

      const imageContainer = document.createElement("div")
      imageContainer.className = "ai-chatbot-product-image"

      const img = document.createElement("img")
      // Sanitize image URL
      img.src = sanitizeHtml(product.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E')
      img.alt = sanitizeHtml(product.name || "Product") // Sanitize alt text
      img.loading = "lazy"
      // Basic error handling for images
      img.onerror = () => { img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E'; img.alt = 'Image failed to load'; };


      imageContainer.appendChild(img)

      const infoDiv = document.createElement("div")
      infoDiv.className = "ai-chatbot-product-info"

      const nameDiv = document.createElement("div")
      nameDiv.className = "ai-chatbot-product-name"
      nameDiv.textContent = product.name || "Product Name" // Use textContent for safety

      const descDiv = document.createElement("div")
      descDiv.className = "ai-chatbot-product-description"
      descDiv.textContent = product.description || "No description available" // Use textContent

      infoDiv.appendChild(nameDiv)
      infoDiv.appendChild(descDiv)

      if (product.price) {
        const priceDiv = document.createElement("div")
        priceDiv.className = "ai-chatbot-product-price"
        priceDiv.textContent = product.price // Use textContent
        infoDiv.appendChild(priceDiv)
      }

      if (product.match_reason) {
        const matchDiv = document.createElement("div")
        matchDiv.className = "ai-chatbot-product-match"
        matchDiv.textContent = product.match_reason // Use textContent
        infoDiv.appendChild(matchDiv)
      }

      productCard.appendChild(imageContainer)
      productCard.appendChild(infoDiv)
      productSection.appendChild(productCard)
    })

    elements.messagesArea.appendChild(productSection)
    scrollToBottom()
  }

  // Send a message
  function sendMessage(customMessage = null) {
    // Ensure elements are ready
    if (!elements || !elements.inputField || !elements.sendButton) {
        console.error("Cannot send message, elements not ready.");
        return;
    }

    const message = customMessage || elements.inputField.value.trim()
    if (!message) return

    const now = Date.now()
    if (now - lastMessageTime < config.rateLimit) {
      addErrorMessage(`Please wait a moment before sending another message.`)
      return
    }

    lastMessageTime = now
    lastUserMessage = message // Store the message being sent
    if (!customMessage) { // Don't clear input if it was a suggested question click
        elements.inputField.value = ""
    }
    elements.sendButton.disabled = true

    addMessage(message, "user")
    showTypingIndicator()

    // Check client cache
    const cachedResponse = getCachedResponse(message)
    if (cachedResponse) {
      console.log("Using cached response for:", message);
      setTimeout(() => {
        hideTypingIndicator()
        handleResponse(cachedResponse)
      }, 500) // Simulate delay
      return
    }

    // Format conversation history
    const history = messages
      .filter((msg) => msg.sender === "user" || msg.sender === "bot")
      .slice(-6) // Last 3 turns (user+bot)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant", // Use 'assistant' for bot
        content: msg.text, // Send plain text content
      }))

    // Prepare parameters for JSONP request
    const params = {
        action: "search",
        query: message, // No need to encodeURIComponent here, URLSearchParams handles it
        history: JSON.stringify(history) // Stringify history
    };
    if (config.apiKey) {
        params.apiKey = config.apiKey;
    }

    // Use the robust JSONP function
    makeJsonpRequest(
        config.apiUrl,
        params,
        "chatbotCallback_",
        config.apiTimeout,
        // Success Callback
        (data) => {
            hideTypingIndicator();
            if (data.error) {
                addErrorMessage(`Error: ${data.error}`, message); // Pass original message for retry
            } else {
                setCachedResponse(message, data); // Cache successful response
                handleResponse(data);
            }
        },
        // Error Callback (timeout or script load error)
        (errorMsg) => {
            hideTypingIndicator();
            addErrorMessage(`${errorMsg}. Please try again.`, message); // Pass original message for retry
        }
    );
  }

  // Handle response from backend
  function handleResponse(data) {
    // Display the bot's text response
    if (data.text) {
      addMessage(data.text, "bot")
    } else {
        // Add a fallback message if text is missing
        addMessage("Sorry, I couldn't process that properly. Can you try asking differently?", "bot");
    }

    // Display products if available
    if (data.products && Array.isArray(data.products) && data.products.length > 0) {
      lastRecommendedProducts = data.products
      displayProducts(data.products)
    } else {
        lastRecommendedProducts = []; // Clear if no products
    }

    // Display suggested questions if available in the response (optional)
    if (data.suggestedQuestions && Array.isArray(data.suggestedQuestions) && data.suggestedQuestions.length > 0) {
        addSuggestedQuestions(data.suggestedQuestions);
    }
  }

  // Client-side caching functions
  function getCachedResponse(query) {
    const key = simpleHash(query)
    const cached = messageCache.get(key)

    if (cached && Date.now() - cached.timestamp < config.clientCacheTTL) {
      return cached.data
    }
    // Cache expired or not found
    if (cached) {
        messageCache.delete(key); // Remove expired entry
    }
    return null
  }

  function setCachedResponse(query, data) {
    const key = simpleHash(query)

    // Implement LRU-like eviction if cache gets too large
    if (messageCache.size >= config.clientCacheSize && !messageCache.has(key)) {
      // Find oldest entry key (Map iterates in insertion order)
      const oldestKey = messageCache.keys().next().value;
      if (oldestKey) {
        messageCache.delete(oldestKey);
        // console.log("Cache evicted:", oldestKey);
      }
    }

    messageCache.set(key, {
      data: data,
      timestamp: Date.now(),
    })
    // console.log("Cache set:", key);
  }

  // Simple hash function for cache keys
  function simpleHash(str) {
    let hash = 0
    if (str.length === 0) return "pb_h_0"
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0 // Convert to 32bit integer
    }
    // Make it a valid JS identifier prefix + hash
    return "pb_h_" + Math.abs(hash).toString(36)
  }

  // Scroll messages to bottom
  function scrollToBottom() {
    // Ensure elements are ready
    if (elements && elements.messagesArea) {
        // Use smooth scrolling if available
        if ('scrollBehavior' in document.documentElement.style) {
            elements.messagesArea.scrollTo({ top: elements.messagesArea.scrollHeight, behavior: 'smooth' });
        } else {
            elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight; // Fallback
        }
    }
  }

  // Get SVG icon
  function getIconSvg(name) {
    // Feather Icons SVG content
    const icons = {
      "message-circle":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
      "minimize-2":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      x: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>',
      "help-circle": // Example, not used currently
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      "message-square": // Example, not used currently
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    }

    return icons[name] || icons["message-circle"] // Fallback to message-circle
  }

  // Initialize
  function init() {
    // Ensure styles are injected before creating elements that rely on them
    injectStyles()
    // Create elements and store references
    const els = createWidget()
    return els
  }

  // Store elements globally within the IIFE scope after initialization
  let elements = null;
  // Defer initialization until DOM is ready
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { elements = init(); });
  } else {
      // DOM is already ready
      elements = init();
  }

})()
