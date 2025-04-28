/**
 * Enhanced Shopify AI Chatbot Widget for Planet Beauty
 * This script creates and manages the chatbot widget with improved UI/UX
 */

;(() => {
  // Configuration
  const DEFAULT_CONFIG = {
    apiUrl: "https://script.google.com/macros/s/AKfycbys0cIz4SYCFS3h7xue2TFPHBe8RiT94Bbgb0Gg0sg4fJF4OY-NoLUiCfxcvIFuStrS/exec",
    primaryColor: "#e91e63",
    secondaryColor: "#ff80ab",
    textColor: "#ffffff",
    position: "bottom-right",
    icon: "message-circle",
    botName: "Bella",
    welcomeMessage: "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
    typingIndicatorText: "Bella is typing...",
    responseDelay: 800, // ms to simulate typing
    maxMessageHistory: 8,
  }

  // Get configuration from script tag
  const scriptTag = document.getElementById("ai-chatbot-script")
  const config = {
    ...DEFAULT_CONFIG,
    apiUrl: scriptTag?.getAttribute("data-api-url") || DEFAULT_CONFIG.apiUrl,
    apiKey: scriptTag?.getAttribute("data-api-key") || "",
    primaryColor: scriptTag?.getAttribute("data-primary-color") || DEFAULT_CONFIG.primaryColor,
    secondaryColor: scriptTag?.getAttribute("data-secondary-color") || DEFAULT_CONFIG.secondaryColor,
    textColor: scriptTag?.getAttribute("data-text-color") || DEFAULT_CONFIG.textColor,
    position: scriptTag?.getAttribute("data-position") || DEFAULT_CONFIG.position,
    botName: scriptTag?.getAttribute("data-bot-name") || DEFAULT_CONFIG.botName,
    welcomeMessage: scriptTag?.getAttribute("data-welcome-message") || DEFAULT_CONFIG.welcomeMessage.replace("Bella", scriptTag?.getAttribute("data-bot-name") || "Bella"),
  }

  // State
  let isOpen = false
  const messages = []
  let isTyping = false
  let typingTimeout = null

  // Create and inject styles
  function injectStyles() {
    const style = document.createElement("style")
    style.textContent = `
      .ai-chatbot-widget * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        margin: 0;
        padding: 0;
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
        transition: all 0.3s ease;
      }
      
      .ai-chatbot-toggle:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }
      
      .ai-chatbot-toggle svg {
        width: 28px;
        height: 28px;
      }
      
      .ai-chatbot-container {
        position: absolute;
        bottom: 70px;
        width: 380px;
        height: 550px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        opacity: 0;
        transform: translateY(20px) scale(0.95);
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
        background: linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor});
        color: ${config.textColor};
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
      }
      
      .ai-chatbot-header-title {
        display: flex;
        align-items: center;
        font-weight: 600;
        font-size: 16px;
        gap: 8px;
      }
      
      .ai-chatbot-header-title svg {
        width: 20px;
        height: 20px;
      }
      
      .ai-chatbot-header-actions {
        display: flex;
        gap: 4px;
      }
      
      .ai-chatbot-header-button {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: ${config.textColor};
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ai-chatbot-header-button:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: scale(1.1);
      }
      
      .ai-chatbot-header-button svg {
        width: 16px;
        height: 16px;
      }
      
      .ai-chatbot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background-color: #fafafa;
      }
      
      .ai-chatbot-message {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 18px;
        font-size: 14px;
        line-height: 1.5;
        animation: fadeIn 0.3s ease;
      }
      
      .ai-chatbot-message.bot {
        align-self: flex-start;
        background-color: white;
        border-bottom-left-radius: 4px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        border: 1px solid #eee;
      }
      
      .ai-chatbot-message.user {
        align-self: flex-end;
        background: linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor});
        color: ${config.textColor};
        border-bottom-right-radius: 4px;
      }
      
      .ai-chatbot-message-time {
        font-size: 10px;
        opacity: 0.7;
        margin-top: 4px;
        text-align: right;
      }
      
      .ai-chatbot-message ul,
      .ai-chatbot-message ol {
        padding-left: 20px;
        margin: 8px 0;
      }
      
      .ai-chatbot-message li {
        margin-bottom: 6px;
      }
      
      .ai-chatbot-product {
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        margin: 8px 0;
        overflow: hidden;
        display: flex;
        max-width: 100%;
        transition: all 0.2s;
        text-decoration: none;
        color: inherit;
      }
      
      .ai-chatbot-product:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        border-color: ${config.primaryColor};
      }
      
      .ai-chatbot-product-image {
        width: 80px;
        height: 80px;
        background: #f5f5f5;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      
      .ai-chatbot-product-image img {
        width: 100%;
        height: 100%;
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
      
      .ai-chatbot-product-price {
        font-weight: 600;
        color: ${config.primaryColor};
        font-size: 14px;
        margin-bottom: 4px;
      }
      
      .ai-chatbot-product-description {
        font-size: 12px;
        color: #666;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      
      .ai-chatbot-typing-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background-color: white;
        border-radius: 18px;
        border-bottom-left-radius: 4px;
        align-self: flex-start;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        border: 1px solid #eee;
        max-width: 85%;
      }
      
      .ai-chatbot-typing-text {
        font-size: 13px;
        color: #666;
      }
      
      .ai-chatbot-typing-dots {
        display: flex;
        gap: 4px;
      }
      
      .ai-chatbot-typing-dot {
        width: 8px;
        height: 8px;
        background: ${config.primaryColor};
        border-radius: 50%;
        animation: typing-dot 1.4s infinite ease-in-out;
      }
      
      .ai-chatbot-typing-dot:nth-child(1) { animation-delay: 0s; }
      .ai-chatbot-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .ai-chatbot-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      
      @keyframes typing-dot {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
        30% { transform: translateY(-3px); opacity: 1; }
      }
      
      .ai-chatbot-input-area {
        padding: 16px;
        border-top: 1px solid #eee;
        background-color: white;
      }
      
      .ai-chatbot-input-container {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .ai-chatbot-input-field {
        flex: 1;
        border: 1px solid #e0e0e0;
        border-radius: 24px;
        padding: 10px 16px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
        min-height: 40px;
        max-height: 120px;
        resize: none;
      }
      
      .ai-chatbot-input-field:focus {
        border-color: ${config.primaryColor};
        box-shadow: 0 0 0 2px rgba(${hexToRgb(config.primaryColor)}, 0.1);
      }
      
      .ai-chatbot-send-button {
        background: linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor});
        color: ${config.textColor};
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .ai-chatbot-send-button:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 8px rgba(${hexToRgb(config.primaryColor)}, 0.3);
      }
      
      .ai-chatbot-send-button:disabled {
        background: #e0e0e0;
        color: #999;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      
      .ai-chatbot-send-button svg {
        width: 18px;
        height: 18px;
      }

      .ai-chatbot-suggested-questions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      
      .ai-chatbot-suggested-question {
        background-color: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 16px;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .ai-chatbot-suggested-question:hover {
        background-color: #e8e8e8;
        transform: translateY(-1px);
      }
      
      .ai-chatbot-divider {
        display: flex;
        align-items: center;
        margin: 12px 0;
        color: #999;
        font-size: 12px;
      }
      
      .ai-chatbot-divider::before,
      .ai-chatbot-divider::after {
        content: "";
        flex: 1;
        border-bottom: 1px solid #eee;
        margin: 0 8px;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      @media (max-width: 480px) {
        .ai-chatbot-container {
          width: calc(100vw - 40px);
          height: 65vh;
          max-height: 600px;
        }
        
        .ai-chatbot-widget.bottom-right .ai-chatbot-container,
        .ai-chatbot-widget.bottom-left .ai-chatbot-container {
          left: 50%;
          right: auto;
          transform: translateX(-50%) translateY(20px) scale(0.95);
        }
        
        .ai-chatbot-widget.open .ai-chatbot-container {
          transform: translateX(-50%) translateY(0) scale(1);
        }
      }
    `
    document.head.appendChild(style)
  }

  // Helper function to convert hex to rgb
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `${r}, ${g}, ${b}`
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
    headerTitle.innerHTML = `${getIconSvg("message-circle")} <span>${config.botName}</span>`

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
    inputArea.className = "ai-chatbot-input-area"

    const inputContainer = document.createElement("div")
    inputContainer.className = "ai-chatbot-input-container"

    const inputField = document.createElement("textarea")
    inputField.className = "ai-chatbot-input-field"
    inputField.placeholder = "Type your beauty question..."
    inputField.rows = 1
    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !sendButton.disabled) {
        e.preventDefault()
        sendMessage()
      }
    })
    inputField.addEventListener("input", () => {
      sendButton.disabled = !inputField.value.trim()
      // Auto-resize textarea
      inputField.style.height = "auto"
      inputField.style.height = `${Math.min(inputField.scrollHeight, 120)}px`
    })

    const sendButton = document.createElement("button")
    sendButton.className = "ai-chatbot-send-button"
    sendButton.setAttribute("aria-label", "Send message")
    sendButton.innerHTML = getIconSvg("send")
    sendButton.disabled = true
    sendButton.addEventListener("click", sendMessage)

    inputContainer.appendChild(inputField)
    inputContainer.appendChild(sendButton)
    inputArea.appendChild(inputContainer)

    // Assemble container
    container.appendChild(header)
    container.appendChild(messagesArea)
    container.appendChild(inputArea)

    // Assemble widget
    widget.appendChild(toggle)
    widget.appendChild(container)

    document.body.appendChild(widget)

    // Add initial welcome message
    setTimeout(() => {
      fetchInitialData()
    }, 500)

    return {
      widget,
      toggle,
      container,
      messagesArea,
      inputField,
      sendButton,
    }
  }

  // Fetch initial welcome message and suggested questions
  function fetchInitialData() {
    try {
      // Create URL with query parameters for Google Apps Script
      const url = new URL(config.apiUrl)
      url.searchParams.append("action", "get_initial_data")
      if (config.apiKey) {
        url.searchParams.append("apiKey", config.apiKey)
      }

      // Use JSONP for cross-origin requests to Google Apps Script
      const callbackName = "chatbotInitCallback_" + Math.random().toString(36).substring(2, 15)

      window[callbackName] = (data) => {
        if (data.error) {
          addMessage(config.welcomeMessage, "bot")
        } else {
          // Add welcome message
          addMessage(data.welcomeMessage || config.welcomeMessage, "bot")

          // Add suggested questions if available
          if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
            addSuggestedQuestions(data.suggestedQuestions)
          }
        }
        // Clean up
        delete window[callbackName]
        document.head.removeChild(script)
      }

      const script = document.createElement("script")
      script.src = `${url.toString()}&callback=${callbackName}`
      document.head.appendChild(script)

      // Set timeout
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName]
          document.head.removeChild(script)
          // Fallback welcome message
          addMessage(config.welcomeMessage, "bot")
        }
      }, 5000)
    } catch (error) {
      console.error("Error fetching initial data:", error)
      // Fallback welcome message
      addMessage(config.welcomeMessage, "bot")
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
        elements.inputField.value = question
        elements.inputField.dispatchEvent(new Event('input'))
        sendMessage()
      })
      suggestedQuestionsContainer.appendChild(questionButton)
    })

    const messageEl = document.createElement("div")
    messageEl.className = "ai-chatbot-message bot"
    messageEl.appendChild(suggestedQuestionsContainer)

    elements.messagesArea.appendChild(messageEl)
    scrollToBottom()
  }

  // Toggle chat open/closed
  function toggleChat() {
    isOpen = !isOpen
    elements.widget.classList.toggle("open", isOpen)

    if (isOpen) {
      elements.inputField.focus()
      scrollToBottom()
    }
  }

  // Add a message to the chat
  function addMessage(text, sender, products = []) {
    const message = {
      text,
      sender,
      products,
      timestamp: new Date(),
    }

    messages.push(message)
    renderMessage(message)
    scrollToBottom()
  }

  // Render a message in the chat
  function renderMessage(message) {
    // Clear typing indicator if it exists
    hideTypingIndicator()

    const messageEl = document.createElement("div")
    messageEl.className = `ai-chatbot-message ${message.sender}`
    
    // Process message text to handle HTML content
    if (message.text.includes('<') && message.text.includes('>')) {
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = message.text
      messageEl.appendChild(tempDiv)
    } else {
      messageEl.textContent = message.text
    }

    // Add timestamp
    const timeEl = document.createElement("div")
    timeEl.className = "ai-chatbot-message-time"
    timeEl.textContent = formatTime(message.timestamp)
    messageEl.appendChild(timeEl)

    elements.messagesArea.appendChild(messageEl)

    // Render products if any
    if (message.products && message.products.length > 0) {
      const productsContainer = document.createElement("div")
      productsContainer.className = "ai-chatbot-message bot"
      productsContainer.style.width = "100%"

      // Add divider
      const divider = document.createElement("div")
      divider.className = "ai-chatbot-divider"
      divider.textContent = "Recommended Products"
      productsContainer.appendChild(divider)

      message.products.forEach((product) => {
        const productEl = document.createElement("a")
        productEl.className = "ai-chatbot-product"
        productEl.href = product.url || "#"
        productEl.target = "_blank"
        productEl.rel = "noopener noreferrer"

        const imageContainer = document.createElement("div")
        imageContainer.className = "ai-chatbot-product-image"

        const img = document.createElement("img")
        img.src =
          product.image ||
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E'
        img.alt = product.name || "Product"
        img.loading = "lazy"

        imageContainer.appendChild(img)

        const infoContainer = document.createElement("div")
        infoContainer.className = "ai-chatbot-product-info"

        const nameEl = document.createElement("div")
        nameEl.className = "ai-chatbot-product-name"
        nameEl.textContent = product.name || "Product Name"

        const descriptionEl = document.createElement("div")
        descriptionEl.className = "ai-chatbot-product-description"
        descriptionEl.textContent = product.description || "No description available"

        const priceEl = document.createElement("div")
        priceEl.className = "ai-chatbot-product-price"
        priceEl.textContent = product.price ? `$${product.price}` : ""

        infoContainer.appendChild(nameEl)
        infoContainer.appendChild(priceEl)
        infoContainer.appendChild(descriptionEl)

        productEl.appendChild(imageContainer)
        productEl.appendChild(infoContainer)

        productsContainer.appendChild(productEl)
      })

      elements.messagesArea.appendChild(productsContainer)
    }
    
    scrollToBottom()
  }

  // Format time for display
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Show typing indicator
  function showTypingIndicator() {
    if (isTyping) return

    isTyping = true

    const typingIndicator = document.createElement("div")
    typingIndicator.className = "ai-chatbot-typing-indicator"

    const typingText = document.createElement("div")
    typingText.className = "ai-chatbot-typing-text"
    typingText.textContent = config.typingIndicatorText

    const typingDots = document.createElement("div")
    typingDots.className = "ai-chatbot-typing-dots"

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div")
      dot.className = "ai-chatbot-typing-dot"
      typingDots.appendChild(dot)
    }

    typingIndicator.appendChild(typingText)
    typingIndicator.appendChild(typingDots)

    elements.messagesArea.appendChild(typingIndicator)
    scrollToBottom()
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    if (!isTyping) return

    const typingIndicator = elements.messagesArea.querySelector(".ai-chatbot-typing-indicator")
    if (typingIndicator) {
      typingIndicator.remove()
    }

    isTyping = false
    if (typingTimeout) {
      clearTimeout(typingTimeout)
      typingTimeout = null
    }
  }

  // Send a message
  function sendMessage() {
    const text = elements.inputField.value.trim()
    if (!text) return

    // Clear input
    elements.inputField.value = ""
    elements.inputField.style.height = "auto"
    elements.sendButton.disabled = true

    // Add user message to chat
    addMessage(text, "user")

    // Show typing indicator
    showTypingIndicator()

    // Send to backend with simulated delay
    typingTimeout = setTimeout(() => {
      fetchResponse(text)
        .then((response) => {
          // Hide typing indicator
          hideTypingIndicator()

          // Add bot response
          addMessage(response.text, "bot", response.products || [])
        })
        .catch((error) => {
          console.error("Error fetching response:", error)
          hideTypingIndicator()
          addMessage("Sorry, I encountered an error. Please try again.", "bot")
        })
    }, config.responseDelay)
  }

  // Fetch response from backend
  async function fetchResponse(query) {
    try {
      // Format the conversation history for the Google Apps Script
      const history = messages.slice(-config.maxMessageHistory).map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text,
      }))

      // Create URL with query parameters for Google Apps Script
      const url = new URL(config.apiUrl)
      url.searchParams.append("action", "search")
      url.searchParams.append("query", query)
      url.searchParams.append("history", JSON.stringify(history))
      if (config.apiKey) {
        url.searchParams.append("apiKey", config.apiKey)
      }

      // Use JSONP for cross-origin requests to Google Apps Script
      return new Promise((resolve, reject) => {
        const callbackName = "chatbotCallback_" + Math.random().toString(36).substring(2, 15)

        window[callbackName] = (data) => {
          if (data.error) {
            reject(new Error(data.error))
          } else {
            resolve({
              text: data.text || "I'm sorry, I couldn't process your request.",
              products: data.products || [],
            })
          }
          // Clean up
          delete window[callbackName]
          document.head.removeChild(script)
        }

        const script = document.createElement("script")
        script.src = `${url.toString()}&callback=${callbackName}`
        document.head.appendChild(script)

        // Set timeout
        setTimeout(() => {
          if (window[callbackName]) {
            delete window[callbackName]
            document.head.removeChild(script)
            reject(new Error("Request timed out"))
          }
        }, 30000)
      })
    } catch (error) {
      console.error("Error in fetchResponse:", error)
      throw error
    }
  }

  // Scroll messages to bottom
  function scrollToBottom() {
    elements.messagesArea.scrollTo({
      top: elements.messagesArea.scrollHeight,
      behavior: 'smooth'
    })
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
      "help-circle":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      "message-square":
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    }

    return icons[name] || icons["message-circle"]
  }

  // Initialize
  function init() {
    injectStyles()
    const els = createWidget()
    return els
  }

  // Store elements for later use
  const elements = init()
})()
