  // Fetch initial welcome message and suggested questions
  function fetchInitialData() {
    const callbackName = `chatbotInitCallback_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    let script = null; // Initialize script variable
    let timeoutId = null; // Variable to hold the timeout ID

    // Define cleanup function within scope to access callbackName, script, timeoutId
    function cleanup() {
      // Clear the timeout just in case cleanup is called before timeout fires
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null; // Nullify the ID after clearing
      }
      // Remove the callback function from the window object safely
      if (window.hasOwnProperty(callbackName)) {
         try {
             delete window[callbackName];
         } catch (e) {
             window[callbackName] = undefined; // Fallback for environments where delete might fail
             console.warn(`Could not delete window.${callbackName}, setting to undefined.`, e);
         }
      }
      // Remove the script tag from the DOM
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
        script = null; // Nullify the script variable
      }
    }

    try {
      const url = new URL(config.apiUrl);
      url.searchParams.append("action", "get_initial_data");
      if (config.apiKey) {
        url.searchParams.append("apiKey", config.apiKey);
      }
      url.searchParams.append("callback", callbackName);

      // Define callback before appending script
      window[callbackName] = (data) => {
        // IMPORTANT: Clear the timeout now that the callback has executed
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        try {
          if (data.error) {
            addErrorMessage(`Error loading initial data: ${sanitizeText(data.error)}`); // Sanitize error
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
          // Clean up after processing
          cleanup();
        }
      };

      script = document.createElement("script");
      script.src = url.toString();
      script.async = true;

      script.onerror = () => {
        // IMPORTANT: Clear the timeout if the script fails to load
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        console.error("Failed to load initial data script.");
        addErrorMessage("Network error loading initial data.");
        addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
        // Clean up on error
        cleanup();
      };

      document.head.appendChild(script);

      // Timeout: Only run error logic if the callback hasn't executed yet
      timeoutId = setTimeout(() => {
        // Check if the callback function *still exists*. If it does, it means
        // neither the success nor the error handler has run and cleaned up.
        if (window[callbackName]) {
            console.warn(`Initial data request timed out for ${callbackName}.`);
            addErrorMessage("Initial data request timed out.");
            addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
            // Perform cleanup because the request genuinely timed out
            cleanup();
        }
        // If window[callbackName] doesn't exist, it means cleanup already happened
        // (either via success or error), so do nothing more here.
        timeoutId = null; // Nullify the ID after timeout logic runs
      }, config.apiTimeout);

    } catch (error) {
      console.error("Error setting up initial data fetch:", error); // Changed log message
      addErrorMessage("Error initializing chatbot.");
      addMessage("Welcome to Planet Beauty! How can I help you today?", "bot");
      // Ensure cleanup happens even if setup fails (e.g., new URL fails)
      cleanup();
    }
  }
