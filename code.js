/**
 * Global cache variables
 */
let PRODUCT_DATA_CACHE = null;
let CACHE_TIMESTAMP = null;

/**
 * Configuration Constants
 */
const DRIVE_CACHE_FILENAME = 'planet_beauty_product_cache_v3.json';
const DRIVE_CACHE_FILE_ID_PROPERTY = 'DRIVE_CACHE_FILE_ID_V3';
const PRODUCT_CACHE_DURATION_SECONDS = 3600 * 6; // 6 hours
const GEMINI_API_KEY_PROPERTY = 'GEMINI_API_KEY'; // Set in Script Properties
const SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID'; // Set in Script Properties
const SHEET_NAME_PROPERTY = 'SHEET_NAME';       // Set in Script Properties
const CACHE_REFRESH_SECRET_KEY_PROPERTY = 'CACHE_REFRESH_SECRET_KEY'; // Optional: Set in Script Properties for refresh action
const EMBEDDING_MODEL = 'embedding-001';
const SIMILARITY_THRESHOLD = 0.4; // Base threshold, dynamic calculation used
const TOP_K_RESULTS = 10;
const MAX_PRODUCTS_TO_LOAD = 1000; // Max products to load from Sheet/Cache
const MAX_HISTORY_TURNS = 3; // Number of user/model turn pairs for history
const EMBEDDING_COLUMN_HEADER = 'embedding'; // Exact header name in Sheet
const MAX_NAME_BRAND_LENGTH = 250; // Max length for name/brand fields
const MAX_DESCRIPTION_LENGTH = 500; // Max length for description field
const MAX_URL_LENGTH = 500;
const MAX_EMBEDDING_DIMENSIONS = 768; // Expected embedding dimensions
const QUERY_EMBEDDING_CACHE_DURATION = 2592000; // 30 days TTL for query embeddings in CacheService
const RESPONSE_CACHE_TTL_SECONDS = 86400; // 1 day TTL for full responses in CacheService
const QUOTA_LIMIT_URLFETCH = 18000; // Safety margin (90% of 20,000) for UrlFetch calls
const QUOTA_KEY_URLFETCH = 'daily_urlfetch_quota_v1'; // Key for PropertiesService quota tracking
const RATE_LIMIT_WINDOW_SECONDS = 60; // Time window for rate limiting
const RATE_LIMIT_MAX_REQUESTS = 15; // Max requests per identifier per window

/**
 * Simple hash function for rate limiting identifier or cache keys if needed.
 */
function simpleHash(str) {
  let hash = 0;
  if (str.length === 0) return 'pb_h_0';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 'pb_h_' + Math.abs(hash).toString(36);
}

/**
 * Gets current date string (YYYY-MM-DD) for daily quota tracking.
 */
function getCurrentDateString_() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Normalizes a product URL or handle. Ensures HTTPS, handles relative paths, slugs.
 */
function normalizeProductUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;

  // Limit initial length check to avoid excessive logging for very long invalid strings
  if (trimmed.length > MAX_URL_LENGTH * 2) {
    Logger.log(`normalizeProductUrl: URL extremely long, potentially invalid: "${trimmed.substring(0,100)}..."`);
    trimmed = trimmed.substring(0, MAX_URL_LENGTH * 2);
  }

  const lowerTrimmed = trimmed.toLowerCase();

  try {
    if (lowerTrimmed.startsWith('http://') || lowerTrimmed.startsWith('https://')) {
      if (lowerTrimmed.startsWith('http://')) {
        trimmed = 'https://' + trimmed.substring(7);
      }
      // Basic check for invalid characters often found in broken data
      if (/[<>"'\s]/.test(trimmed)) {
        Logger.log(`normalizeProductUrl: Invalid characters found in URL "${trimmed.substring(0,100)}...". Returning null.`);
        return null;
      }
      // Apply final length limit
      return trimmed.length > MAX_URL_LENGTH ? trimmed.substring(0, MAX_URL_LENGTH) : trimmed;
    } else if (trimmed.startsWith('/')) {
      // Handle relative paths assuming planetbeauty.com base
      const fullUrl = `https://www.planetbeauty.com${trimmed}`;
      return fullUrl.length > MAX_URL_LENGTH ? fullUrl.substring(0, MAX_URL_LENGTH) : fullUrl;
    } else if (trimmed.length > 0 && !/\s|\/|\./.test(trimmed) && trimmed.length < 100) {
      // Handle potential product slugs (simple check: no spaces, slashes, dots, reasonable length)
      const fullUrl = `https://www.planetbeauty.com/products/${trimmed}`;
      return fullUrl.length > MAX_URL_LENGTH ? fullUrl.substring(0, MAX_URL_LENGTH) : fullUrl;
    } else {
      // Log invalid format if it doesn't match expected patterns
      Logger.log(`normalizeProductUrl: Unrecognized or invalid URL format "${trimmed.substring(0,100)}...". Returning null.`);
      return null;
    }
  } catch (e) {
    Logger.log(`normalizeProductUrl: Error processing URL "${trimmed.substring(0,100)}...": ${e.message}`);
    return null;
  }
}

/**
 * Loads product data and embeddings from Google Sheet.
 * This function is primarily called by the cache refresh mechanism.
 */
function loadProductsAndEmbeddings_() {
  Logger.log('loadProductsAndEmbeddings_: Starting data load from Google Sheet.');
  const startTime = Date.now();
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY); // Use global constant
  const sheetName = PropertiesService.getScriptProperties().getProperty(SHEET_NAME_PROPERTY);

  if (!spreadsheetId || !sheetName) {
    throw new Error("Spreadsheet ID or Sheet Name not configured in Script Properties.");
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found in Spreadsheet ID "${SPREADSHEET_ID_PROPERTY}".`);

    const data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) throw new Error(`No data or only header row found in sheet "${sheetName}".`);

    const headers = data[0].map(h => (h || '').toString().toLowerCase().trim().replace(/\s+/g, '_'));
    Logger.log(`loadProductsAndEmbeddings_: Headers found: ${headers.join(', ')}`);

    // Flexible column finding
    const findIndex = (possibleNames, exactMatch = false) => {
        for (const name of possibleNames) {
            const lowerName = name.toLowerCase();
            const idx = headers.findIndex(h => exactMatch ? h === lowerName : h.includes(lowerName));
            if (idx !== -1) return idx;
        }
        return -1;
    };

    const nameIdx = findIndex(['title', 'name', 'product_name', 'product_title']);
    const descIdx = findIndex(['description', 'desc', 'body_html', 'product_description']);
    const priceIdx = findIndex(['price', 'variant_price']);
    const imageIdx = findIndex(['image_link', 'image_src', 'image', 'featured_image']);
    const urlIdx = findIndex(['url', 'link', 'product_url', 'handle']);
    const brandIdx = findIndex(['brand', 'vendor']);
    const embeddingIdx = findIndex([EMBEDDING_COLUMN_HEADER], true); // Exact match for embedding column

    const missingColumns = [];
    if (nameIdx === -1) missingColumns.push('name/title');
    if (descIdx === -1) missingColumns.push('description');
    if (embeddingIdx === -1) missingColumns.push(`'${EMBEDDING_COLUMN_HEADER}' (exact match)`);
    // Optional columns, log if missing but don't fail
    if (priceIdx === -1) Logger.log("loadProductsAndEmbeddings_: Optional column 'price' not found.");
    if (imageIdx === -1) Logger.log("loadProductsAndEmbeddings_: Optional column 'image' not found.");
    if (urlIdx === -1) Logger.log("loadProductsAndEmbeddings_: Optional column 'url/link/handle' not found.");
    if (brandIdx === -1) Logger.log("loadProductsAndEmbeddings_: Optional column 'brand/vendor' not found.");

    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
     Logger.log(`loadProductsAndEmbeddings_: Column indices - Name: ${nameIdx}, Desc: ${descIdx}, Price: ${priceIdx}, Image: ${imageIdx}, URL: ${urlIdx}, Brand: ${brandIdx}, Embedding: ${embeddingIdx}`);


    const products = [];
    let skippedRowCount = 0;
    let invalidEmbeddingCount = 0;
    let missingNameDescCount = 0;
    let parseEmbeddingErrorCount = 0;
    let processedRowCount = 0;

    // Iterate through rows, respecting MAX_PRODUCTS_TO_LOAD
    for (let i = 1; i < data.length; i++) {
      processedRowCount++;
      if (products.length >= MAX_PRODUCTS_TO_LOAD) {
          Logger.log(`loadProductsAndEmbeddings_: Reached MAX_PRODUCTS_TO_LOAD limit (${MAX_PRODUCTS_TO_LOAD}). Stopping processing.`);
          break;
      }

      const row = data[i];
      const rowNum = i + 1; // For logging

      // Skip empty rows
      if (row.every(cell => cell === null || cell === '')) {
        skippedRowCount++;
        continue;
      }

      // --- Embedding Parsing and Validation ---
      let embedding = null;
      const embeddingRaw = row[embeddingIdx];
      if (embeddingRaw && typeof embeddingRaw === 'string' && embeddingRaw.trim().startsWith('[')) {
        try {
          embedding = JSON.parse(embeddingRaw);
          // Validate embedding structure and content
          if (!Array.isArray(embedding) || embedding.length !== MAX_EMBEDDING_DIMENSIONS || !embedding.every(n => typeof n === 'number' && isFinite(n))) {
             Logger.log(`loadProductsAndEmbeddings_: WARN - Row ${rowNum}: Invalid embedding data (not an array of ${MAX_EMBEDDING_DIMENSIONS} numbers). Skipping.`);
             invalidEmbeddingCount++;
             skippedRowCount++;
             continue;
          }
          // Optional: Normalize embedding vector if needed (though usually not required)
        } catch (e) {
          Logger.log(`loadProductsAndEmbeddings_: WARN - Row ${rowNum}: Error parsing embedding JSON: ${e.message}. Skipping.`);
          parseEmbeddingErrorCount++;
          skippedRowCount++;
          continue;
        }
      } else {
        // Log if embedding is missing or not in expected format
        Logger.log(`loadProductsAndEmbeddings_: WARN - Row ${rowNum}: Missing or invalid embedding format (Expected JSON array string). Skipping.`);
        invalidEmbeddingCount++;
        skippedRowCount++;
        continue;
      }
      // --- End Embedding Validation ---

      // --- Name and Description Validation ---
      const name = row[nameIdx] ? row[nameIdx].toString().trim() : '';
      const description = row[descIdx] ? row[descIdx].toString().trim() : '';
      if (!name || !description) {
        Logger.log(`loadProductsAndEmbeddings_: WARN - Row ${rowNum}: Missing name or description. Skipping.`);
        missingNameDescCount++;
        skippedRowCount++;
        continue;
      }
      // --- End Name/Description Validation ---

      const safeToString = (val) => val ? val.toString().trim() : '';
      const truncate = (str, len) => str.length > len ? str.substring(0, len) : str; // Removed '...' for cleaner data

      // Construct product object
      const product = {
        name: truncate(name, MAX_NAME_BRAND_LENGTH),
        description: truncate(description, MAX_DESCRIPTION_LENGTH),
        price: priceIdx !== -1 ? safeToString(row[priceIdx]) : null,
        image: imageIdx !== -1 ? normalizeProductUrl(safeToString(row[imageIdx])) : null,
        url: urlIdx !== -1 ? normalizeProductUrl(safeToString(row[urlIdx])) : null,
        brand: brandIdx !== -1 ? truncate(safeToString(row[brandIdx]), MAX_NAME_BRAND_LENGTH) : null,
        embedding: embedding // Store the validated embedding
        // category: null // Placeholder, will be added by batch script later
      };

      products.push(product);
    } // End row loop

    Logger.log(`loadProductsAndEmbeddings_: Processed ${processedRowCount} rows. Loaded ${products.length} valid products (Limit: ${MAX_PRODUCTS_TO_LOAD}).`);
    Logger.log(`loadProductsAndEmbeddings_: Skipped Rows Breakdown - Total: ${skippedRowCount}, Invalid/Missing Embedding: ${invalidEmbeddingCount}, Parse Embedding Error: ${parseEmbeddingErrorCount}, Missing Name/Desc: ${missingNameDescCount}`);


    if (products.length === 0) {
      throw new Error('No valid products loaded after processing the sheet. Check sheet data, headers, and embedding format.');
    }

    // Attempt to save the loaded products to Drive cache
    try {
      saveProductsToDriveCache_(products); // This function now uses LockService
      // Update global in-memory cache only after successful save
      PRODUCT_DATA_CACHE = { products: products };
      CACHE_TIMESTAMP = Date.now();
      Logger.log('loadProductsAndEmbeddings_: In-memory cache updated with loaded products.');
    } catch (cacheError) {
      // Log failure but don't necessarily fail the whole load if saving fails
      // The in-memory cache won't be updated in this case.
      Logger.log(`loadProductsAndEmbeddings_: ERROR - Failed to save loaded products to Drive cache: ${cacheError.message}`);
      // Depending on requirements, you might want to throw the error here
      // throw cacheError;
    }

    const duration = Date.now() - startTime;
    Logger.log(`loadProductsAndEmbeddings_: Completed in ${duration}ms.`);
    return products.length; // Return number of products loaded

  } catch (err) {
    Logger.log(`loadProductsAndEmbeddings_: FATAL ERROR - ${err.message} \nStack: ${err.stack}`);
    // Clear potentially inconsistent cache state on fatal error
    PRODUCT_DATA_CACHE = null;
    CACHE_TIMESTAMP = null;
    throw err; // Re-throw the error to indicate failure
  }
}

/**
 * Saves product data to a JSON file in Google Drive with LockService.
 */
function saveProductsToDriveCache_(products) {
  if (!products || !Array.isArray(products)) {
    throw new Error("saveProductsToDriveCache_: Invalid or missing products array provided.");
  }
  Logger.log(`saveProductsToDriveCache_: Attempting to save ${products.length} products to Drive cache file "${DRIVE_CACHE_FILENAME}".`);
  const startTime = Date.now();

  const lock = LockService.getScriptLock();
  let success = lock.tryLock(20000); // Wait up to 20 seconds for the lock
  if (!success) {
    Logger.log('saveProductsToDriveCache_: Could not obtain lock to write Drive cache.');
    throw new Error('Failed to acquire lock for saving product cache. Another process might be writing.');
  }
  Logger.log('saveProductsToDriveCache_: Acquired Drive cache write lock.');

  try {
    // Prepare data structure for saving
    const cacheData = {
      timestamp: Date.now(), // Use current timestamp for the cache file
      productCount: products.length,
      products: products // The actual product array
    };

    let jsonString;
    try {
      jsonString = JSON.stringify(cacheData);
      // Check size limit (Drive file limit is 50MB, JSON stringify can be larger)
      // Using 45MB as a safety margin for potential overhead
      if (jsonString.length > 45 * 1024 * 1024) {
        throw new Error(`Cache data JSON size (${(jsonString.length / 1024 / 1024).toFixed(1)} MB) exceeds safety limit.`);
      }
       Logger.log(`saveProductsToDriveCache_: JSON string created (length: ${jsonString.length} bytes).`);
    } catch (stringifyError) {
      throw new Error(`Failed to serialize cache data to JSON: ${stringifyError.message}`);
    }

    const properties = PropertiesService.getScriptProperties();
    let fileId = properties.getProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
    let file;
    let operation = "updated"; // Assume update initially

    // --- Find or Create Drive File ---
    if (fileId) {
      try {
        file = DriveApp.getFileById(fileId);
        Logger.log(`saveProductsToDriveCache_: Found existing file by ID: ${fileId}, Name: "${file.getName()}"`);
      } catch (e) {
        // If getFileById fails (e.g., file deleted, ID invalid), clear the property and try finding by name
        Logger.log(`saveProductsToDriveCache_: File ID ${fileId} invalid or access error: ${e.message}. Attempting to find by name or create new.`);
        properties.deleteProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
        fileId = null;
        file = null; // Ensure file is null
      }
    }

    // If file wasn't found by ID, try by name
    if (!file) {
      const files = DriveApp.getFilesByName(DRIVE_CACHE_FILENAME);
      if (files.hasNext()) {
        file = files.next();
        fileId = file.getId();
        properties.setProperty(DRIVE_CACHE_FILE_ID_PROPERTY, fileId); // Update property with correct ID
        Logger.log(`saveProductsToDriveCache_: Found existing file by name. ID: ${fileId}, Name: "${file.getName()}"`);
        if (files.hasNext()) {
           Logger.log(`saveProductsToDriveCache_: WARNING - Multiple files found with name "${DRIVE_CACHE_FILENAME}". Using the first one found.`);
           // Consider adding logic here to delete duplicates if desired
        }
      } else {
        // If no file found by ID or name, create a new one
        operation = "created";
        Logger.log(`saveProductsToDriveCache_: No existing cache file found. Creating new file: "${DRIVE_CACHE_FILENAME}"`);
        file = DriveApp.createFile(DRIVE_CACHE_FILENAME, jsonString, MimeType.PLAIN_TEXT);
        fileId = file.getId();
        properties.setProperty(DRIVE_CACHE_FILE_ID_PROPERTY, fileId);
        Logger.log(`saveProductsToDriveCache_: Successfully created new Drive cache file. ID: ${fileId}, Name: "${file.getName()}"`);
        // If creating, no need to set content again below
      }
    }
    // --- End Find or Create ---

    // If we found an existing file (by ID or name), update its content
    if (operation === "updated") {
       Logger.log(`saveProductsToDriveCache_: Updating content for file ID: ${fileId}`);
       file.setContent(jsonString);
       Logger.log(`saveProductsToDriveCache_: Successfully updated Drive cache file content.`);
    }

    const duration = Date.now() - startTime;
    Logger.log(`saveProductsToDriveCache_: File ${operation} successfully in ${duration}ms (including lock wait).`);

  } catch (e) {
    // Log detailed error during Drive operation
    Logger.log(`saveProductsToDriveCache_: ERROR during Drive operation: ${e.message} \nStack: ${e.stack}`);
    // Re-throw a more specific error
    throw new Error(`Drive cache file operation failed: ${e.message}`);
  } finally {
    lock.releaseLock();
    Logger.log('saveProductsToDriveCache_: Released Drive cache write lock.');
  }
}

/**
 * Loads product data from the Drive cache file.
 */
function loadProductsFromDriveCache_() {
  Logger.log('loadProductsFromDriveCache_: Attempting to load cache from Drive.');
  const startTime = Date.now();
  const properties = PropertiesService.getScriptProperties();
  const fileId = properties.getProperty(DRIVE_CACHE_FILE_ID_PROPERTY);

  if (!fileId) {
    Logger.log('loadProductsFromDriveCache_: No Drive cache File ID found in properties.');
    return null;
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    const fileSize = file.getSize();
    Logger.log(`loadProductsFromDriveCache_: Reading file ID ${fileId} ("${fileName}"), Size: ${fileSize} bytes.`);

    const jsonString = file.getBlob().getDataAsString();
    if (!jsonString) {
      Logger.log('loadProductsFromDriveCache_: WARN - Drive cache file is empty.');
      return null;
    }

    const data = JSON.parse(jsonString);

    // Validate the structure of the loaded data
    if (!data || typeof data !== 'object' || typeof data.timestamp !== 'number' || !Array.isArray(data.products)) {
      Logger.log('loadProductsFromDriveCache_: ERROR - Invalid cache structure in Drive file.');
      // Consider deleting or renaming the corrupted file here?
      // DriveApp.getFileById(fileId).setTrashed(true);
      // properties.deleteProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
      return null;
    }

    const duration = Date.now() - startTime;
    Logger.log(`loadProductsFromDriveCache_: Successfully loaded and parsed ${data.products.length} products in ${duration}ms.`);
    return data; // Return the full cache object { timestamp, productCount, products }

  } catch (e) {
    // Handle specific error if file not found (e.g., deleted manually)
    if (e.message.includes("Not Found") || e.message.includes("getFileById")) {
      Logger.log(`loadProductsFromDriveCache_: File ID ${fileId} not found or inaccessible. Clearing property.`);
      properties.deleteProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
    } else {
      // Log other errors
      Logger.log(`loadProductsFromDriveCache_: ERROR loading/parsing Drive cache: ${e.message}`);
    }
    return null; // Return null on any error
  }
}

/**
 * Checks if the global in-memory product cache is expired.
 */
function isCacheExpired_() {
  if (!CACHE_TIMESTAMP) return true; // No timestamp means expired/not loaded
  const ageSeconds = (Date.now() - CACHE_TIMESTAMP) / 1000;
  const isExpired = ageSeconds >= PRODUCT_CACHE_DURATION_SECONDS;
  if (isExpired) {
      Logger.log(`isCacheExpired_: In-memory cache IS expired (Age: ${ageSeconds.toFixed(0)}s, Max: ${PRODUCT_CACHE_DURATION_SECONDS}s)`);
  } else {
      // Logger.log(`isCacheExpired_: In-memory cache is valid (Age: ${ageSeconds.toFixed(0)}s)`); // Can be verbose
  }
  return isExpired;
}


/**
 * Computes cosine similarity between two vectors.
 */
function cosineSimilarity_(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
      // Added more robust checks
      // Logger.log(`cosineSimilarity_: Invalid input vectors. A length: ${vecA?.length}, B length: ${vecB?.length}`);
      return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = vecA.length;
  for (let i = 0; i < len; i++) {
    // Ensure values are numbers
    const valA = Number(vecA[i]) || 0;
    const valB = Number(vecB[i]) || 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  // Check for zero norms to avoid division by zero
  if (normA === 0 || normB === 0) {
      // Logger.log('cosineSimilarity_: Zero norm detected.');
      return 0;
  }
  return dotProduct / (normA * normB);
}

/**
 * Calculates dynamic similarity threshold based on standard deviation.
 */
function calculateDynamicThreshold_(scoredProducts) {
  if (!scoredProducts || scoredProducts.length === 0) return SIMILARITY_THRESHOLD;

  // Use only similarity scores for threshold calculation
  const similarities = scoredProducts.map(p => p.similarity).filter(s => typeof s === 'number' && isFinite(s) && s > 0); // Filter out non-positive/invalid

  if (similarities.length < 5) { // Need a minimum number of scores for meaningful stats
      // Logger.log(`calculateDynamicThreshold_: Too few valid similarity scores (${similarities.length}) to calculate dynamic threshold. Using base: ${SIMILARITY_THRESHOLD}`);
      return SIMILARITY_THRESHOLD;
  }

  // Calculate mean and standard deviation
  const mean = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
  const variance = similarities.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / similarities.length;
  const stdDev = Math.sqrt(variance);

  // Calculate threshold: mean minus some factor of std dev
  // Adjusting factor (e.g., 0.5 to 1.0) controls strictness
  const calculatedThreshold = mean - (0.75 * stdDev);

  // Clamp threshold between base minimum and a reasonable maximum (e.g., 0.8)
  const dynamicThreshold = Math.min(Math.max(calculatedThreshold, SIMILARITY_THRESHOLD), 0.8);

  // Logger.log(`calculateDynamicThreshold_: Mean=${mean.toFixed(3)}, StdDev=${stdDev.toFixed(3)}, Calc=${calculatedThreshold.toFixed(3)}, Final=${dynamicThreshold.toFixed(3)}`);
  return dynamicThreshold;
}

/**
 * Gets query embedding from Gemini API, using CacheService for caching.
 * Increments quota counter internally.
 */
/**
 * Gets query embedding from CacheService, Precomputed Sheet (on quota fail), or Gemini API.
 * Increments quota counter internally ONLY for API calls.
 */
function getQueryEmbedding_(query, apiKey) {
  const functionName = 'getQueryEmbedding_';
  const lowerQuery = query.toLowerCase(); // Use lowercased query consistently
  Logger.log(`${functionName}: Getting embedding for query "${lowerQuery.substring(0, 50)}..."`);
  const cache = CacheService.getScriptCache();

  // Generate cache key based on query and model
  const queryHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lowerQuery + EMBEDDING_MODEL)
    .map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2))
    .join('');
  const cacheKey = `query_emb_v1_${queryHash}`;

  // --- 1. Check CacheService ---
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsedEmbedding = JSON.parse(cached);
      if (Array.isArray(parsedEmbedding) && parsedEmbedding.length === MAX_EMBEDDING_DIMENSIONS) {
        Logger.log(`${functionName}: Using CACHED embedding from CacheService.`);
        return parsedEmbedding;
      } else {
         Logger.log(`${functionName}: WARN - CacheService embedding data invalid. Removing.`);
         cache.remove(cacheKey);
      }
    } catch (e) {
      Logger.log(`${functionName}: WARN - Error parsing CacheService embedding: ${e.message}. Removing.`);
      cache.remove(cacheKey);
    }
  }
  Logger.log(`${functionName}: CacheService MISS for embedding.`);

  // --- 2. Check Quota & Try Precomputed if Exceeded ---
  if (isUrlFetchQuotaExceeded_()) {
      Logger.log(`${functionName}: UrlFetch quota EXCEEDED. Checking precomputed embeddings...`);
      const precomputedEmbedding = getPrecomputedEmbedding_(lowerQuery); // Pass lowercased query
      if (precomputedEmbedding) {
          // Cache the precomputed embedding in CacheService for faster access next time
          try {
              cache.put(cacheKey, JSON.stringify(precomputedEmbedding), QUERY_EMBEDDING_CACHE_DURATION);
              Logger.log(`${functionName}: Cached the found precomputed embedding into CacheService.`);
          } catch (cacheError) {
              Logger.log(`${functionName}: WARN - Failed to cache precomputed embedding into CacheService: ${cacheError.message}`);
          }
          return precomputedEmbedding; // Return the found precomputed embedding
      } else {
          Logger.log(`${functionName}: No suitable precomputed embedding found. Cannot generate new embedding due to quota.`);
          // *** IMPORTANT: Return null here to trigger keyword fallback ***
          return null;
      }
  }

  // --- 3. Quota OK - Call Gemini API ---
  Logger.log(`${functionName}: Quota OK. Calling Gemini API for new embedding.`);
  incrementUrlFetchQuotaCounter_(); // Increment *before* the fetch

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const payload = {
    content: { parts: [{ text: lowerQuery }], role: "user" }, // Use lowercased query
    task_type: 'RETRIEVAL_QUERY'
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: { 'Content-Type': 'application/json' }
  };

  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (fetchError) {
    // Handle network-level errors
    Logger.log(`${functionName}: Network error during UrlFetch: ${fetchError.message}`);
    // Don't try precomputed here if network failed. Return null to trigger keyword fallback.
    return null;
  }

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    let errorMsg = `Gemini Embedding API Error (HTTP ${responseCode})`;
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.error && errorData.error.message) {
        errorMsg += `: ${errorData.error.message}`;
      } else {
         errorMsg += `: ${responseText.substring(0, 200)}`;
      }
    } catch (e) {
       errorMsg += `: ${responseText.substring(0, 200)}`;
    }
    Logger.log(`${functionName}: ${errorMsg}`);
    // If API call failed (even if not quota), return null to trigger keyword fallback
    return null;
  }

  // --- Parse and Validate API Response ---
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    Logger.log(`${functionName}: ERROR - Invalid JSON response from Gemini Embedding API: ${e.message}. Response: ${responseText.substring(0,500)}`);
    return null; // Trigger keyword fallback
  }

  const embedding = data?.embedding?.values;
  if (!embedding || !Array.isArray(embedding) || embedding.length !== MAX_EMBEDDING_DIMENSIONS || !embedding.every(n => typeof n === 'number' && isFinite(n))) {
    Logger.log(`${functionName}: ERROR - Invalid or missing embedding data in API response. Length: ${embedding?.length}`);
    return null; // Trigger keyword fallback
  }

  // --- Cache Successful API Result ---
  try {
    cache.put(cacheKey, JSON.stringify(embedding), QUERY_EMBEDDING_CACHE_DURATION);
    Logger.log(`${functionName}: Successfully fetched and cached new embedding from API.`);
  } catch (cacheError) {
    Logger.log(`${functionName}: WARN - Failed to cache new API embedding: ${cacheError.message}`);
  }

  return embedding; // Return the newly fetched embedding
}

/**
 * Calls Gemini API for query intent analysis and text generation.
 * Increments quota counter internally.
 */
function callGeminiAPI_(query, conversationHistory, apiKey) {
  const functionName = 'callGeminiAPI_'; // For logging context
  Logger.log(`${functionName}: Processing query "${query.substring(0, 50)}..." with ${conversationHistory.length} history turns.`);
  const model = 'gemini-1.5-flash'; // Use flash for speed/cost effectiveness
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxOutputTokens = 500; // Max tokens for the response JSON

  // --- System Instruction ---
  // Refined prompt incorporating "how-to-use" instructions
  let systemInstruction = `You are Bella, Planet Beauty's expert AI shopping assistant for https://www.planetbeauty.com. Your goal is to provide helpful, empathetic, and accurate beauty advice and product suggestions based ONLY on the user's LATEST query, using conversation history primarily for context.

**Your Personality:**
* Friendly & Enthusiastic: Like a knowledgeable friend passionate about beauty. Use emojis appropriately 😊✨💖.
* Empathetic: Acknowledge user feelings if expressed.
* AI Aware: Gently clarify you're an AI if asked about personal experiences.
* Positive & Encouraging: Frame suggestions positively.
* Concise: Get to the point quickly. Keep responses under 150 words unless providing detailed steps.

**Core Task:**
1. Analyze the LATEST User Query: "${query.trim()}"
2. Consider Conversation History (last ${MAX_HISTORY_TURNS * 2} messages): Use history for context ONLY.
3. Classify Intent based *only* on the LATEST query:
   * \`product\`: Request for one or more specific, named products.
   * \`list\`: Request for a category or type of product, often with criteria.
   * \`informational\`: General chat, advice, how-to questions, greetings, procedural questions (e.g., "how are you?", "how do I apply blush?", "what's your return policy?").
   * \`clarification_needed\`: If the query is vague or lacks details needed for a product search.
   * \`unknown\`: If intent is unclear or ambiguous.
4. Extract Search Criteria (for 'product'/'list' intents from the LATEST query):
   * \`product_type\`: Main product category mentioned (e.g., "serum", "moisturizer"). Null if not applicable.
   * \`attributes\`: List of key features, constraints, or benefits mentioned (e.g., "hydrating", "vegan", "sensitive skin", "retinol"). Include brand names if mentioned as criteria. Empty array if none. DO NOT invent criteria.
5. Formulate Response Text:
   * **Product/List**: Acknowledge the query enthusiastically. Briefly mention what you're looking for. (e.g., "Let's find that specific oil for you! ✨", "Okay, looking for great moisturizers for sensitive skin! 💖"). The system will add product details later.
   * **Informational**: Answer the question directly and helpfully. Keep it concise.
   * **How-To-Use Handling**: If the query asks how to use/apply products, especially if related to recent context (keywords: "apply", "use", "how do I"), provide a clear, step-by-step guide in the 'text' response. Use a caring, helpful tone. Base instructions on general product *type* best practices if the specific product isn't named in the *current* query. Use basic HTML lists (\`<ul><li>...\`) if helpful for steps.
   * **Clarification Needed**: Ask a clear, specific question to gather missing details (e.g., "What’s your skin type so I can recommend the best moisturizer? 😊").
   * **Unknown**: Politely ask for clarification (e.g., "Could you tell me a bit more about what you're looking for? 😊").
6. Determine Max Results (for product search):
   * \`product\`: Usually 1-3 results.
   * \`list\`: Usually 5-${TOP_K_RESULTS} results.
   * \`informational\`, \`clarification_needed\`, \`unknown\`: 0 results.

**Output Format:** Respond ONLY with a valid JSON object string matching this structure:
{
  "text": "string", // Your response to the user, potentially with basic HTML like <ul><li> for steps.
  "query_type": "string", // One of: product, list, informational, clarification_needed, unknown
  "search_criteria": {
    "product_type": "string | null",
    "attributes": ["string"] // Empty array if none
  },
  "max_results": number // Number of products to search for (0 if no search needed)
}`;
  // --- End System Instruction ---


  // --- Check & Increment Quota BEFORE API Call ---
  if (isUrlFetchQuotaExceeded_()) {
      Logger.log(`${functionName}: UrlFetch quota exceeded. Cannot call Gemini API.`);
      // Return an error object that doGet can handle
      return { error: 'Service temporarily busy due to high demand. Please try again in a few minutes.' };
  }
  incrementUrlFetchQuotaCounter_(); // Increment *before* the fetch
  // --- End Quota Check ---

  // Construct payload
  const payload = {
    contents: [ // Order: History first, then current query
      ...conversationHistory,
      { role: 'user', parts: [{ text: query }] }
    ],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.5, // Lower temp for more predictable classification/response
      maxOutputTokens: maxOutputTokens,
      responseMimeType: 'application/json' // Expecting JSON output
    },
    safetySettings: [ // Standard safety settings
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // Handle errors manually
    headers: { 'Content-Type': 'application/json' }
  };

  // --- API Call ---
  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (fetchError) {
    Logger.log(`${functionName}: Network error during UrlFetch: ${fetchError.message}`);
    // Don't decrement quota
    return { error: `Network error contacting AI assistant: ${fetchError.message}` };
  }
  // --- End API Call ---

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  // --- Handle API Response ---
  if (responseCode !== 200) {
    let errorMsg = `Gemini API Error (HTTP ${responseCode})`;
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.error && errorData.error.message) {
        errorMsg += `: ${errorData.error.message}`;
      } else {
         errorMsg += `: ${responseText.substring(0, 200)}`;
      }
    } catch (e) {
       errorMsg += `: ${responseText.substring(0, 200)}`;
    }
    Logger.log(`${functionName}: ${errorMsg}`);
    // Don't decrement quota
    return { error: errorMsg.substring(0, 300) }; // Return error object
  }

  // --- Parse Valid Response ---
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    Logger.log(`${functionName}: ERROR - Invalid JSON response from Gemini API: ${e.message}. Response: ${responseText.substring(0,500)}`);
    return { error: "Invalid response format from AI assistant." };
  }

  const candidate = data?.candidates?.[0];
  const contentText = candidate?.content?.parts?.[0]?.text;

  // Check for valid content text
  if (!contentText) {
    Logger.log(`${functionName}: No content text found in Gemini response. Finish Reason: ${candidate?.finishReason}. Full Response: ${JSON.stringify(data)}`);
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return { error: `AI request stopped unexpectedly: ${candidate.finishReason}` };
    }
    return { error: 'AI assistant did not provide a valid response.' };
  }

  // --- Parse the JSON *within* the content text ---
  let parsedContent;
  try {
    // Remove potential markdown code fences
    const cleanedContentText = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    parsedContent = JSON.parse(cleanedContentText);
  } catch (e) {
    Logger.log(`${functionName}: ERROR - Failed to parse JSON *within* content: ${e.message}. Content: ${contentText.substring(0, 500)}`);
    // Fallback: Try to return the raw text if parsing fails? Or return error.
    // return { text: contentText, query_type: 'unknown', search_criteria: {}, max_results: 0 }; // Fallback?
     return { error: "AI assistant returned response in an unexpected format." };
  }

  // Validate the structure of the parsed content
  if (!parsedContent || typeof parsedContent.text !== 'string' || typeof parsedContent.query_type !== 'string') {
    Logger.log(`${functionName}: ERROR - Invalid structure in parsed content JSON: ${JSON.stringify(parsedContent)}`);
    return { error: "AI assistant returned incomplete response data." };
  }

  // Ensure search_criteria exists, default if missing
  parsedContent.search_criteria = parsedContent.search_criteria || { product_type: null, attributes: [] };
  if (!Array.isArray(parsedContent.search_criteria.attributes)) {
      parsedContent.search_criteria.attributes = [];
  }
  // Ensure max_results exists, default if missing
  parsedContent.max_results = parsedContent.max_results || (['product', 'list'].includes(parsedContent.query_type) ? TOP_K_RESULTS : 0);


  Logger.log(`${functionName}: Successfully processed query. Type: ${parsedContent.query_type}, Criteria: ${JSON.stringify(parsedContent.search_criteria)}`);
  return parsedContent; // Return the structured data { text, query_type, search_criteria, max_results }
}


/**
 * Generates initial bot data (welcome message and suggested questions).
 * Increments quota counter internally.
 */
function getInitialBotData_(apiKey) {
  const functionName = 'getInitialBotData_'; // For logging context
  Logger.log(`${functionName}: Generating initial data...`);

  // --- Check & Increment Quota BEFORE API Call ---
  // Note: This call is already wrapped in a quota check in doGet,
  // but adding one here provides defense-in-depth if called directly.
  // However, to avoid double counting, rely on the check in doGet.
  // if (isUrlFetchQuotaExceeded_()) { ... }
  // incrementUrlFetchQuotaCounter_(); // Increment is done in doGet before calling this
  // --- End Quota Check ---


  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Static welcome message options for consistency
  const welcomeOptions = [
      "Hey there! ✨ Ask me anything about Planet Beauty products, get personalized recommendations, or beauty tips!",
      "Welcome to Planet Beauty! 😊 Tell me what you're looking for, or ask for some beauty advice!",
      "Hi! I'm Bella, your AI beauty guide. Ready to find your next favorite product or get some tips? ✨",
      "Hello! Looking for specific products, recommendations for your skin type, or just some beauty chat? Let me know! 💖"
  ];
  const randomWelcome = welcomeOptions[Math.floor(Math.random() * welcomeOptions.length)];

  // Prompt for suggested questions
  const prompt = {
      contents: [{
          role: 'user',
          parts: [{ text: `Generate 5 concise, beginner-friendly beauty questions suitable for Planet Beauty customers. Return ONLY a valid JSON array of 5 unique strings.` }]
      }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 200, responseMimeType: 'application/json' },
      safetySettings: [ /* Standard safety settings */
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
  };

   const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(prompt),
      muteHttpExceptions: true
  };

  // --- API Call ---
  let response;
  try {
      response = UrlFetchApp.fetch(url, options);
  } catch (fetchError) {
      Logger.log(`${functionName}: Network error during UrlFetch: ${fetchError.message}`);
      throw new Error(`Network error fetching initial data: ${fetchError.message}`);
  }
  // --- End API Call ---

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  // --- Handle API Response ---
  if (responseCode !== 200) {
      let errorMsg = `Gemini API Error for initial questions (HTTP ${responseCode})`;
      // ... (error message parsing as in callGeminiAPI_) ...
       try { const errorData = JSON.parse(responseText); if (errorData.error && errorData.error.message) errorMsg += `: ${errorData.error.message}`; else errorMsg += `: ${responseText.substring(0, 200)}`; } catch (e) { errorMsg += `: ${responseText.substring(0, 200)}`; }
      Logger.log(`${functionName}: ${errorMsg}`);
      throw new Error(errorMsg.substring(0, 300));
  }

  // --- Parse Valid Response ---
  let data;
  try {
      data = JSON.parse(responseText);
  } catch (e) {
      Logger.log(`${functionName}: ERROR - Invalid JSON response: ${e.message}. Response: ${responseText.substring(0,500)}`);
      throw new Error('Invalid JSON response for initial questions.');
  }

  const candidate = data?.candidates?.[0];
  const contentText = candidate?.content?.parts?.[0]?.text;

  if (!contentText) {
      Logger.log(`${functionName}: No content text found. Finish Reason: ${candidate?.finishReason}.`);
      if (candidate?.finishReason && candidate.finishReason !== "STOP") {
          throw new Error(`AI request for questions stopped unexpectedly: ${candidate.finishReason}`);
      }
      throw new Error('AI assistant did not provide suggested questions.');
  }

  // --- Parse the JSON *within* the content text ---
  let questions;
  try {
      const cleanedContentText = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      questions = JSON.parse(cleanedContentText);
  } catch (e) {
      Logger.log(`${functionName}: ERROR - Failed to parse questions JSON *within* content: ${e.message}. Content: ${contentText.substring(0, 500)}`);
      throw new Error('AI assistant returned questions in an unexpected format.');
  }

  // Validate the structure
  if (!Array.isArray(questions) || questions.length < 5 || !questions.every(q => typeof q === 'string')) {
       Logger.log(`${functionName}: ERROR - Invalid questions array structure: ${JSON.stringify(questions)}`);
       throw new Error('AI assistant returned invalid suggested questions data.');
  }

  Logger.log(`${functionName}: Successfully generated initial data.`);
  return {
      welcomeMessage: randomWelcome,
      suggestedQuestions: questions.slice(0, 5) // Return exactly 5
  };
}

/**
 * Helper function to check if a product matches all required attributes (case-insensitive).
 */
function productMatchesAllAttributes_(product, attributes) {
  if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
    return true; // No attributes specified, so it's a match by default
  }

  // Combine relevant text fields for searching. Include category if available.
  const productText = `${product.name || ''} ${product.description || ''} ${product.brand || ''} ${product.category || ''}`.toLowerCase();

  // Define synonyms or related terms if needed
  const synonyms = {
    // 'hydrating': ['moisturizing', 'hydration'], // Example
    // 'vegan': ['plant-based']
  };

  for (let attribute of attributes) {
    if (!attribute || typeof attribute !== 'string') continue; // Skip invalid attributes

    attribute = attribute.toLowerCase().trim();
    if (!attribute) continue; // Skip empty attributes

    let matches = productText.includes(attribute);

    // Check synonyms if no direct match
    if (!matches && synonyms[attribute]) {
      matches = synonyms[attribute].some(syn => productText.includes(syn));
    }

    // If *any* attribute is not found, the product fails the AND condition
    if (!matches) {
      // Logger.log(`Attribute "${attribute}" NOT found in product "${product.name}"`); // Can be verbose
      return false;
    }
  }

  // If the loop completes without returning false, all attributes were found
  // Logger.log(`All attributes ${JSON.stringify(attributes)} FOUND in product "${product.name}"`);
  return true;
}

/**
 * Generates a simple reason why a product matches the search criteria.
 */
function generateMatchReason_(product, searchCriteria) {
  const reasons = [];
  if (!product || !searchCriteria) return null;

  const productText = `${product.name || ''} ${product.description || ''} ${product.brand || ''} ${product.category || ''}`.toLowerCase();

  // Define user-friendly terms for reasons
  const reasonTemplates = {
    'vegan': 'Vegan',
    'hydrating': 'Hydrating',
    'moisturizer': 'Moisturizer',
    'serum': 'Serum',
    'cleanser': 'Cleanser',
    'shampoo': 'Shampoo',
    'conditioner': 'Conditioner',
    'retinol': 'Contains Retinol',
    'sensitive skin': 'For Sensitive Skin',
    'oil-free': 'Oil-Free'
    // Add more mappings as needed
  };

  // Check product type match
  const productType = searchCriteria?.product_type?.toLowerCase();
  if (productType && productText.includes(productType)) {
    reasons.push(reasonTemplates[productType] || searchCriteria.product_type); // Use template or original type
  }

  // Check attribute matches
  const attributes = searchCriteria?.attributes;
  if (attributes && Array.isArray(attributes)) {
    attributes.forEach(attr => {
      if (!attr || typeof attr !== 'string') return;
      const lowerAttr = attr.toLowerCase().trim();
      if (!lowerAttr) return;

      // Check if attribute text is present in the product
      if (productText.includes(lowerAttr)) {
         const reasonText = reasonTemplates[lowerAttr] || attr; // Use template or original attribute
         // Avoid adding duplicate reasons (e.g., if type and attribute are the same)
         if (!reasons.some(r => r.toLowerCase() === reasonText.toLowerCase())) {
            reasons.push(reasonText);
         }
      }
    });
  }

  if (reasons.length > 0) {
    // Limit number of reasons shown for brevity
    const displayReasons = reasons.slice(0, 2); // Show max 2 reasons
    // Capitalize first letter of each reason for display
    const formattedReasons = displayReasons.map(r => r.charAt(0).toUpperCase() + r.slice(1));
    return `Matches: ${formattedReasons.join(', ')}${reasons.length > 2 ? '...' : ''}`;
  }

  return null; // No specific reason found based on criteria
}


/**
 * Searches products using hybrid scoring or keyword fallback.
 */
function searchProductsBySimilarity_(userQuery, topK, searchCriteria = {}, apiKey, productsToSearch) {
  const functionName = 'searchProductsBySimilarity_';
  Logger.log(`${functionName}: Query: "${userQuery}", TopK: ${topK}, Criteria: ${JSON.stringify(searchCriteria)}`);
  const startTime = Date.now();

  if (!productsToSearch || !Array.isArray(productsToSearch) || productsToSearch.length === 0) {
    Logger.log(`${functionName}: No product data provided.`);
    return [];
  }
  const productCount = productsToSearch.length;
  Logger.log(`${functionName}: Searching within ${productCount} products.`);

  let cleanedQuery = userQuery.trim().toLowerCase();
  const prefixes = ['find this product:', 'search for:', 'look up:', 'find:', 'get:', 'show me:', 'show:'];
  for (const prefix of prefixes) {
    if (cleanedQuery.startsWith(prefix)) {
      cleanedQuery = cleanedQuery.substring(prefix.length).trim();
      break;
    }
  }
  Logger.log(`${functionName}: Cleaned query: "${cleanedQuery}"`);

  // Try semantic search first
  let queryEmbedding = null;
  try {
    if (!isUrlFetchQuotaExceeded_()) {
      queryEmbedding = getQueryEmbedding_(cleanedQuery, apiKey);
    }
  } catch (embedError) {
    Logger.log(`${functionName}: Embedding error: ${embedError.message}`);
  }

  if (queryEmbedding) {
    // --- Perform SEMANTIC SEARCH ---
    Logger.log(`${functionName}: Performing semantic search.`);
    const scoredProducts = [];
    let invalidProductEmbeddings = 0;
    let dimensionMismatchCount = 0;

    for (let i = 0; i < productCount; i++) {
      const product = productsToSearch[i];

      if (!product.embedding || !Array.isArray(product.embedding) || product.embedding.length === 0) {
        invalidProductEmbeddings++;
        continue;
      }

      if (product.embedding.length !== queryEmbedding.length) {
        if (dimensionMismatchCount < 5) {
          Logger.log(`${functionName}: Skipping product "${product.name?.substring(0,30)}..." due to dimension mismatch (${product.embedding.length} vs ${queryEmbedding.length}).`);
        } else if (dimensionMismatchCount === 5) {
          Logger.log(`${functionName}: Further dimension mismatch warnings suppressed.`);
        }
        dimensionMismatchCount++;
        invalidProductEmbeddings++;
        continue;
      }

      const similarity = cosineSimilarity_(queryEmbedding, product.embedding);

      let textMatchScore = 0;
      const productNameLower = product.name.toLowerCase();
      const cleanedQueryWords = cleanedQuery ? cleanedQuery.split(/\s+/) : [];
      const productNameWords = productNameLower.split(/\s+/);
      const validQueryWords = cleanedQueryWords.filter(w => w.length > 0);
      const validNameWords = productNameWords.filter(w => w.length > 0);

      if (validQueryWords.length > 0 && validNameWords.length > 0) {
        const matchedWords = validQueryWords.filter(word => validNameWords.includes(word)).length;
        const queryMatchRatio = matchedWords / validQueryWords.length;
        const nameMatchRatio = matchedWords / validNameWords.length;
        if (queryMatchRatio > 0.6 || nameMatchRatio > 0.6) {
          textMatchScore = 0.9;
        } else if (cleanedQuery && productNameLower.includes(cleanedQuery)) {
          textMatchScore = 0.7;
        }
      } else if (cleanedQuery && productNameLower.includes(cleanedQuery)) {
        textMatchScore = 0.7;
      }

      const finalScore = (0.6 * similarity) + (0.4 * textMatchScore);

      scoredProducts.push({
        name: product.name,
        price: product.price,
        description: product.description,
        image: product.image,
        url: product.url,
        brand: product.brand,
        category: product.category,
        score: finalScore,
        similarity: similarity,
        textMatchScore: textMatchScore
      });
    }

    if (invalidProductEmbeddings > 0) {
      Logger.log(`${functionName}: Skipped ${invalidProductEmbeddings} products due to invalid/mismatched embeddings.`);
    }
    if (scoredProducts.length === 0) {
      Logger.log(`${functionName}: No products scored in semantic search.`);
      return [];
    }

    // Filter by attributes (AND logic)
    const requiredAttributes = (searchCriteria?.attributes || []).filter(attr => attr && typeof attr === 'string' && attr.trim().length > 0);
    const attributeFiltered = requiredAttributes.length > 0
      ? scoredProducts.filter(p => productMatchesAllAttributes_(p, requiredAttributes))
      : scoredProducts;

    Logger.log(`${functionName}: ${attributeFiltered.length}/${scoredProducts.length} products passed attribute filter (Attributes: ${JSON.stringify(requiredAttributes)}).`);

    if (attributeFiltered.length === 0) {
      Logger.log(`${functionName}: No products matched all required attributes in semantic search.`);
      return [];
    }

    // Sort by score
    attributeFiltered.sort((a, b) => b.score - a.score);

    // Apply dynamic threshold
    const dynamicThreshold = calculateDynamicThreshold_(attributeFiltered);
    const thresholdFiltered = attributeFiltered.filter(p => p.score >= dynamicThreshold);

    Logger.log(`${functionName}: ${thresholdFiltered.length}/${attributeFiltered.length} products passed dynamic threshold filter (Threshold: ${dynamicThreshold.toFixed(3)}).`);

    let finalFilteredResults = thresholdFiltered.length > 0 ? thresholdFiltered : attributeFiltered;
    let results = finalFilteredResults.slice(0, topK);

    // Deduplicate
    const seen = new Set();
    const uniqueResults = [];
    for (const product of results) {
      const key = `${product.name}|${product.brand || ''}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const matchReason = generateMatchReason_(product, searchCriteria);
        uniqueResults.push({
          name: product.name,
          price: product.price,
          description: product.description,
          image: product.image,
          url: product.url,
          brand: product.brand,
          category: product.category,
          score: product.score,
          match_reason: matchReason
        });
      }
      if (uniqueResults.length >= topK) break;
    }

    const duration = Date.now() - startTime;
    Logger.log(`${functionName}: Semantic search completed in ${duration}ms. Returned ${uniqueResults.length} unique products.`);
    return uniqueResults;
  } else {
    // --- Perform KEYWORD SEARCH ---
    Logger.log(`${functionName}: Falling back to keyword search due to quota or embedding failure.`);
    const queryWords = cleanedQuery.split(/\s+/).filter(w => w.length > 1);
    if (queryWords.length === 0) {
      Logger.log(`${functionName}: No valid query words for keyword search.`);
      return [];
    }

    const keywordScoredProducts = productsToSearch.map(product => {
      const productText = `${product.name || ''} ${product.description || ''} ${product.brand || ''} ${product.category || ''}`.toLowerCase();
      let score = 0;
      let matchedWords = 0;
      queryWords.forEach(word => {
        if (productText.includes(word)) {
          matchedWords++;
        }
      });
      if (productText.includes(cleanedQuery)) { // Boost exact phrase match
        score += 0.5;
      }
      score += 0.5 * (matchedWords / queryWords.length); // Score based on word overlap

      return { ...product, score: score, similarity: 0, textMatchScore: score };
    }).filter(p => p.score > 0.1); // Basic threshold to remove non-matches

    // Filter by attributes (AND logic)
    const requiredAttributes = (searchCriteria?.attributes || []).filter(attr => attr && typeof attr === 'string' && attr.trim().length > 0);
    const attributeFiltered = requiredAttributes.length > 0
      ? keywordScoredProducts.filter(p => productMatchesAllAttributes_(p, requiredAttributes))
      : keywordScoredProducts;

    Logger.log(`${functionName}: ${attributeFiltered.length}/${keywordScoredProducts.length} products passed attribute filter in keyword search (Attributes: ${JSON.stringify(requiredAttributes)}).`);

    if (attributeFiltered.length === 0) {
      Logger.log(`${functionName}: No products matched keyword search after attribute filtering.`);
      return [];
    }

    // Sort by keyword score
    attributeFiltered.sort((a, b) => b.score - a.score);

    // Deduplicate
    const seen = new Set();
    const uniqueResults = [];
    for (const product of attributeFiltered.slice(0, topK)) {
      const key = `${product.name}|${product.brand || ''}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const matchReason = generateMatchReason_(product, searchCriteria);
        uniqueResults.push({
          name: product.name,
          price: product.price,
          description: product.description,
          image: product.image,
          url: product.url,
          brand: product.brand,
          category: product.category,
          score: product.score,
          match_reason: matchReason
        });
      }
      if (uniqueResults.length >= topK) break;
    }

    const duration = Date.now() - startTime;
    Logger.log(`${functionName}: Keyword search completed in ${duration}ms. Returned ${uniqueResults.length} unique products.`);
    return uniqueResults;
  }
}

/**
 * Caches full response in CacheService.
 */
function setResponseInCache_(query, responseData) {
  try {
    const cache = CacheService.getScriptCache();
    // Use a simpler hash for cache keys if Utilities.computeDigest is too slow/complex
    const cacheKey = `resp_v2_${simpleHash(query)}`; // Changed version prefix
    cache.put(cacheKey, JSON.stringify(responseData), RESPONSE_CACHE_TTL_SECONDS);
    Logger.log(`setResponseInCache_: Cached response for "${query.substring(0, 50)}..." (Key: ${cacheKey})`);
  } catch (e) {
    // Log errors, especially if CacheService quota is hit (though less likely than UrlFetch)
    Logger.log(`setResponseInCache_: CacheService put error: ${e.message}. Data size: ${JSON.stringify(responseData).length} bytes.`);
  }
}

/**
 * Retrieves cached response from CacheService.
 */
function getResponseFromCache_(query) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `resp_v2_${simpleHash(query)}`; // Match version prefix
    const cached = cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      Logger.log(`getResponseFromCache_: CacheService HIT for "${query.substring(0, 50)}..." (Key: ${cacheKey})`);
      return parsed; // Return parsed data
    }
    // Logger.log(`getResponseFromCache_: CacheService MISS for "${query.substring(0, 50)}..." (Key: ${cacheKey})`); // Can be verbose
    return null;
  } catch (e) {
    Logger.log(`getResponseFromCache_: CacheService get/parse error: ${e.message}`);
    return null; // Return null on error
  }
}

/**
 * Checks if the user/session has exceeded the rate limit using User Cache.
 */
function isRateLimited_(identifier) {
  try {
    // Use User Cache - tied to the user making the request (if logged in) or a temporary anonymous key
    const cache = CacheService.getUserCache();
    const cacheKey = `rate_limit_v1_${identifier}`; // Add versioning
    const now = Date.now(); // Use milliseconds for comparison
    const windowStartMs = now - (RATE_LIMIT_WINDOW_SECONDS * 1000);

    let requestTimestamps = [];
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      try {
        requestTimestamps = JSON.parse(cachedData);
        // Filter out timestamps older than the window
        requestTimestamps = requestTimestamps.filter(ts => ts >= windowStartMs);
      } catch (parseError) {
         Logger.log(`isRateLimited_: WARN - Failed to parse rate limit history for ${identifier}. Resetting history.`);
         requestTimestamps = []; // Reset if data is corrupt
      }
    }

    // Check if limit exceeded
    if (requestTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      Logger.log(`isRateLimited_: Rate limit EXCEEDED for identifier "${identifier}" (${requestTimestamps.length}/${RATE_LIMIT_MAX_REQUESTS})`);
      return true; // Limit exceeded
    }

    // Add current timestamp and update cache
    requestTimestamps.push(now);
    try {
      // Cache for slightly longer than the window to ensure persistence
      cache.put(cacheKey, JSON.stringify(requestTimestamps), RATE_LIMIT_WINDOW_SECONDS + 10);
    } catch (cachePutError) {
       // Log if putting fails (e.g., cache quota) but don't block the request
       Logger.log(`isRateLimited_: WARN - Failed to update rate limit cache for ${identifier}: ${cachePutError.message}`);
    }

    // Logger.log(`isRateLimited_: Allowed request for "${identifier}" (${requestTimestamps.length}/${RATE_LIMIT_MAX_REQUESTS})`);
    return false; // Limit not exceeded

  } catch (e) {
    // Log any unexpected errors during rate limit check but allow request to proceed (fail open)
    Logger.log(`isRateLimited_: ERROR checking rate limit for ${identifier}: ${e.message}`);
    return false;
  }
}

/**
 * Checks if UrlFetchApp daily quota is likely exceeded using PropertiesService.
 */
function isUrlFetchQuotaExceeded_() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const quotaData = properties.getProperty(QUOTA_KEY_URLFETCH);
    const today = getCurrentDateString_();
    let count = 0;

    if (quotaData) {
      try {
          const quota = JSON.parse(quotaData);
          // Check if the stored date is today's date
          if (quota && quota.date === today && typeof quota.count === 'number') {
              count = quota.count;
          } else {
              // Data is from a previous day or invalid, reset count implicitly
              Logger.log(`isUrlFetchQuotaExceeded_: Quota data is stale or invalid. Resetting count for ${today}.`);
          }
      } catch (parseError) {
          Logger.log(`isUrlFetchQuotaExceeded_: WARN - Failed to parse quota data: ${parseError.message}. Assuming count is 0.`);
          // If parsing fails, assume count is 0 to avoid blocking unnecessarily
      }
    }

    const exceeded = count >= QUOTA_LIMIT_URLFETCH;
    if (exceeded) {
        Logger.log(`isUrlFetchQuotaExceeded_: Quota CHECK = EXCEEDED (Count: ${count}/${QUOTA_LIMIT_URLFETCH})`);
    }
    return exceeded;

  } catch (e) {
    // Log error but fail open (assume not exceeded) if property service fails
    Logger.log(`isUrlFetchQuotaExceeded_: ERROR reading quota property: ${e.message}`);
    return false;
  }
}

/**
 * Increments UrlFetchApp daily quota counter in PropertiesService using LockService.
 */
function incrementUrlFetchQuotaCounter_() {
  const lock = LockService.getScriptLock();
  let success = lock.tryLock(5000); // Shorter timeout for counter increment
  if (!success) {
    Logger.log('incrementUrlFetchQuotaCounter_: Could not acquire lock. Quota count not incremented.');
    // Consider if this should throw an error or just log
    // throw new Error('Failed to acquire quota lock.');
    return; // Exit without incrementing if lock fails
  }

  try {
    const properties = PropertiesService.getScriptProperties();
    const quotaData = properties.getProperty(QUOTA_KEY_URLFETCH);
    const today = getCurrentDateString_();
    let quota = { count: 0, date: today }; // Default structure

    if (quotaData) {
       try {
           const parsedQuota = JSON.parse(quotaData);
           // Use existing count if date matches, otherwise reset
           if (parsedQuota && parsedQuota.date === today && typeof parsedQuota.count === 'number') {
               quota = parsedQuota;
           } else {
                Logger.log(`incrementUrlFetchQuotaCounter_: Resetting quota count for new day ${today}.`);
           }
       } catch (parseError) {
            Logger.log(`incrementUrlFetchQuotaCounter_: WARN - Failed to parse existing quota data: ${parseError.message}. Resetting count.`);
            // Reset count if parsing fails
       }
    }

    quota.count += 1; // Increment the count

    try {
        properties.setProperty(QUOTA_KEY_URLFETCH, JSON.stringify(quota));
        // Logger.log(`incrementUrlFetchQuotaCounter_: Quota incremented to ${quota.count}/${QUOTA_LIMIT_URLFETCH} for ${today}.`); // Can be verbose
    } catch (propError) {
         Logger.log(`incrementUrlFetchQuotaCounter_: ERROR setting quota property: ${propError.message}`);
         // Log error but proceed
    }

  } catch (e) {
    // Catch any unexpected errors during the process
    Logger.log(`incrementUrlFetchQuotaCounter_: ERROR during increment logic: ${e.message}`);
  } finally {
    lock.releaseLock(); // Ensure lock is always released
  }
}


/**
 * Sends JSONP response, ensuring valid JSON and callback format.
 */
function sendJsonpResponse_(callback, data) {
  let jsonString;
  try {
    // Ensure data is always an object
    const responseData = (typeof data === 'object' && data !== null) ? data : { error: "Invalid server data." };
    jsonString = JSON.stringify(responseData);
  } catch (e) {
    // Handle potential circular references or other stringify errors
    Logger.log(`sendJsonpResponse_: ERROR stringifying response data: ${e.message}`);
    jsonString = JSON.stringify({ error: "Server error formatting response." });
  }

  // Ensure callback name is safe (already checked in doGet, but double-check)
  const safeCallback = /^[a-zA-Z0-9_]+$/.test(callback) ? callback : 'invalidCallback';
  if (safeCallback === 'invalidCallback') {
      Logger.log(`sendJsonpResponse_: ERROR - Invalid callback name detected: ${callback}`);
  }

  const response = `${safeCallback}(${jsonString})`;
  return ContentService.createTextOutput(response)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ==========================================================================
// === MAIN WEB APP ENTRY POINT (doGet) =====================================
// ==========================================================================
function doGet(e) {
  const startTime = Date.now();
  const callback = e.parameter.callback || 'callback'; // Default callback name
  const action = (e.parameter.action || 'search').toLowerCase();
  Logger.log(`doGet START - Action: ${action}, Callback: ${callback}, Params: ${JSON.stringify(e?.parameter).substring(0, 200)}...`);

  // 1. Validate Callback Name
  if (!/^[a-zA-Z0-9_]+$/.test(callback)) {
    Logger.log("doGet ERROR: Invalid callback name format.");
    // Return plain text error as JSONP cannot be formed
    return ContentService.createTextOutput("Error: Invalid callback parameter.")
                         .setMimeType(ContentService.MimeType.TEXT);
  }

  // 2. Rate Limiting (Per User/Session)
  // Use session key if user is logged in, otherwise hash parameters (less reliable for anonymous)
  let rateLimitIdentifier = Session.getTemporaryActiveUserKey() || simpleHash(JSON.stringify(e?.parameter || 'anon_user'));
  if (isRateLimited_(rateLimitIdentifier)) {
    Logger.log(`doGet: Rate limit exceeded for identifier: ${rateLimitIdentifier}`);
    return sendJsonpResponse_(callback, { error: 'Too many requests. Please wait a moment and try again.' });
  }

  try {
    // 3. Load API Key (Fail fast if not configured)
    const scriptProperties = PropertiesService.getScriptProperties();
    const apiKey = scriptProperties.getProperty(GEMINI_API_KEY_PROPERTY);
    if (!apiKey) {
      throw new Error(`CRITICAL: Script Property "${GEMINI_API_KEY_PROPERTY}" is not set.`);
    }

    // ===================================
    // === ACTION: Get Initial Data ====
    // ===================================
    if (action === 'get_initial_data') {
      Logger.log("doGet: Handling action 'get_initial_data'.");
      // Check quota *before* making the API call
      if (isUrlFetchQuotaExceeded_()) {
        Logger.log("doGet: Quota exceeded for get_initial_data. Returning fallback.");
        return sendJsonpResponse_(callback, {
          welcomeMessage: "Welcome! Ask me anything or try a suggestion below.",
          suggestedQuestions: [ /* Static fallbacks */
            "Best moisturizer for dry skin?", "Sulfate-free shampoo recommendations?",
            "Products for oily skin?", "Vegan lipsticks under $20?", "How to choose foundation shade?"
          ]
        });
      }
      // Increment quota counter *before* the call
      incrementUrlFetchQuotaCounter_();
      try {
        const initialData = getInitialBotData_(apiKey); // Call function to get data
        return sendJsonpResponse_(callback, initialData);
      } catch (initError) {
        Logger.log(`doGet: ERROR getting initial data: ${initError.message}`);
        // Return fallback data on error
        return sendJsonpResponse_(callback, {
          welcomeMessage: "Welcome! Ask me anything or try a suggestion below.",
          suggestedQuestions: [ /* Static fallbacks */
             "Best moisturizer for dry skin?", "Sulfate-free shampoo recommendations?",
             "Products for oily skin?", "Vegan lipsticks under $20?", "How to choose foundation shade?"
          ]
        });
      }
    } // --- End action 'get_initial_data' ---

    // ===================================
    // === ACTION: Search ==============
    // ===================================
    if (action === 'search') {
      Logger.log("doGet: Handling action 'search'.");
      const query = e.parameter.query || e.parameter.q || '';
      if (!query || query.trim().length === 0) {
        return sendJsonpResponse_(callback, { error: 'Query parameter is missing or empty.' });
      }
      const sanitizedQuery = query.trim();
      Logger.log(`doGet: Processing search query: "${sanitizedQuery.substring(0, 100)}..."`);

      // 4. Check CacheService for Full Response
      const cachedResponse = getResponseFromCache_(sanitizedQuery);
      if (cachedResponse) {
        Logger.log("doGet: Returning cached response from CacheService.");
        const duration = Date.now() - startTime;
        Logger.log(`doGet END (Cached) - Duration: ${duration}ms`);
        return sendJsonpResponse_(callback, cachedResponse);
      }

      // 5. Check Quota (again, before making API calls for non-cached requests)
      if (isUrlFetchQuotaExceeded_()) {
        Logger.log(`doGet: Quota exceeded for search query: ${sanitizedQuery}`);
        return sendJsonpResponse_(callback, { error: 'Service temporarily busy due to high demand. Please try again later.' });
      }

      // 6. Load Product Data (from global cache or Drive)
      let productsAvailable = false;
      let productLoadError = null;
      if (PRODUCT_DATA_CACHE && !isCacheExpired_()) {
        productsAvailable = true;
        // Logger.log("doGet: Using valid in-memory product cache."); // Can be verbose
      } else {
        Logger.log("doGet: In-memory product cache missing or expired. Loading from Drive...");
        try {
            const driveCacheData = loadProductsFromDriveCache_();
            if (driveCacheData && driveCacheData.products && driveCacheData.timestamp) {
                // Update global cache
                PRODUCT_DATA_CACHE = { products: driveCacheData.products };
                CACHE_TIMESTAMP = driveCacheData.timestamp;
                productsAvailable = true;
                Logger.log(`doGet: Successfully loaded ${PRODUCT_DATA_CACHE.products.length} products from Drive cache. Timestamp: ${new Date(CACHE_TIMESTAMP).toISOString()}`);
                // Check expiry again after loading, just in case load was slow
                if (isCacheExpired_()) {
                     Logger.log(`doGet: WARN - Drive cache loaded is already considered expired (Age > ${PRODUCT_CACHE_DURATION_SECONDS}s). Using it anyway.`);
                }
            } else {
                Logger.log("doGet: Failed to load valid data from Drive cache file.");
                // Optionally trigger a refresh if load fails? Be careful of loops.
                // try { loadProductsAndEmbeddings_(); productsAvailable = true; } catch(e){ Logger.log("Forced reload failed"); }
            }
        } catch (loadError) {
             Logger.log(`doGet: ERROR loading products from Drive: ${loadError.message}`);
             productLoadError = loadError; // Store error
        }
      }
      // --- End Product Data Load ---

      // 7. Process Query with Gemini (Intent Analysis)
      let geminiResponse;
      let responseData = {}; // Initialize response structure

      // Quota increment for this call happens *within* callGeminiAPI_ after its internal check
      try {
        let conversationHistory = [];
        if (e.parameter.conversationHistory) {
          try {
            conversationHistory = JSON.parse(e.parameter.conversationHistory);
            if (!Array.isArray(conversationHistory)) throw new Error('Invalid history format');
            // Limit history length *before* sending to API
            conversationHistory = conversationHistory.slice(-MAX_HISTORY_TURNS * 2);
          } catch (histError) {
            Logger.log(`doGet: Invalid history format: ${histError.message}. History: ${e.parameter.conversationHistory.substring(0,100)}`);
            conversationHistory = []; // Reset to empty on error
          }
        }

        // callGeminiAPI_ handles its own quota check/increment
        geminiResponse = callGeminiAPI_(sanitizedQuery, conversationHistory, apiKey);
        if (geminiResponse.error) {
          // Return specific error from Gemini call
          return sendJsonpResponse_(callback, { error: geminiResponse.error });
        }

        // Populate base response data from Gemini result
        responseData = {
          text: geminiResponse.text || 'Sorry, I couldn’t understand. Please rephrase.',
          query_type: geminiResponse.query_type || 'unknown',
          search_criteria_used: geminiResponse.search_criteria || { product_type: null, attributes: [] },
          products: [] // Initialize products array
        };

      } catch (geminiError) {
        // Catch errors from the callGeminiAPI_ function itself (e.g., network)
        Logger.log(`doGet: ERROR calling/processing Gemini API: ${geminiError.message}`);
        return sendJsonpResponse_(callback, { error: 'Failed to process request with AI assistant.' });
      }
      // --- End Gemini Intent Analysis ---


      // 8. Perform Product Search (if applicable)
      const isProductSearch = ['product', 'list'].includes(geminiResponse.query_type);
      const needsClarification = geminiResponse.query_type === 'clarification_needed';

	if (isProductSearch && !needsClarification && productsAvailable && PRODUCT_DATA_CACHE?.products?.length > 0) {
	  Logger.log(`doGet: Performing product search for query_type '${geminiResponse.query_type}'.`);
	  try {
		responseData.products = searchProductsBySimilarity_(
		  sanitizedQuery,
		  geminiResponse.max_results || TOP_K_RESULTS,
		  geminiResponse.search_criteria || {},
		  apiKey,
		  PRODUCT_DATA_CACHE.products
		);
		if (responseData.products.length > 0) {
		  const criteriaDesc = Object.keys(responseData.search_criteria_used).length > 0
			? `based on your request for ${responseData.search_criteria_used.product_type || 'products'} ${responseData.search_criteria_used.attributes?.length > 0 ? `with ${responseData.search_criteria_used.attributes.join(', ')}` : ''}`
			: 'based on relevance';
		  responseData.text += `\n\nFound ${responseData.products.length} product${responseData.products.length > 1 ? 's' : ''} ${criteriaDesc}.`;
		} else {
		  responseData.text += `\n\nNo products found matching your request. Try broadening your search!`;
		}
		// Check if keyword search was used (no embedding)
		if (responseData.products.length > 0 && responseData.products.every(p => p.similarity === 0)) {
		  responseData.text += `\n\nUsing keyword search due to high demand. Results may be less precise.`;
		}
	  } catch (searchError) {
		Logger.log(`doGet: Search error: ${searchError.message}`);
		responseData.text += " (Issue during product search.)";
	  }
	}
	  // --- End Product Search ---

      // 9. Cache the final successful response in CacheService
      setResponseInCache_(sanitizedQuery, responseData);

      // 10. Send Response
      const duration = Date.now() - startTime;
      Logger.log(`doGet END (Processed) - Duration: ${duration}ms`);
      return sendJsonpResponse_(callback, responseData);

    } // --- End action 'search' ---

    // ===================================
    // === ACTION: Refresh Cache =======
    // ===================================
    else if (action === 'refresh_cache') {
      Logger.log("doGet: Handling action 'refresh_cache'.");
      const storedSecret = scriptProperties.getProperty(CACHE_REFRESH_SECRET_KEY_PROPERTY);
      // IMPORTANT: Add authentication/authorization check
      if (!storedSecret || e.parameter.secret !== storedSecret) {
        Logger.log("doGet: Unauthorized cache refresh attempt.");
        return sendJsonpResponse_(callback, { error: 'Unauthorized cache refresh.' });
      }
      Logger.log("doGet: Authorized cache refresh request received.");
      try {
        // loadProductsAndEmbeddings_ saves to Drive and updates global vars
        const productCount = loadProductsAndEmbeddings_();
        // Optionally clear CacheService response cache after a full refresh
        // CacheService.getScriptCache().removeAll([...keys...]); // More complex to get all keys
        Logger.log("doGet: Cache refresh successful.");
        return sendJsonpResponse_(callback, { status: 'Cache refreshed successfully.', productCount: productCount });
      } catch (refreshError) {
        Logger.log(`doGet: Cache refresh failed: ${refreshError.message}`);
        return sendJsonpResponse_(callback, { error: `Cache refresh failed: ${refreshError.message}` });
      }
    } // --- End action 'refresh_cache' ---

    // ===================================
    // === Unknown Action ==============
    // ===================================
    else {
      Logger.log(`doGet: Unknown action requested: ${action}`);
      return sendJsonpResponse_(callback, { error: `Unknown action: ${action}` });
    }

  } catch (fatalError) {
    // Catch any unexpected errors in the main try block
    Logger.log(`doGet FATAL Error: ${fatalError.message}\nStack: ${fatalError.stack}`);
    // Avoid caching fatal errors
    return sendJsonpResponse_(callback, { error: 'Server encountered an unexpected error. Please try again later.' });
  }
} // === END doGet ===

// ==========================================================================
// === Helper Functions (Keep all previously defined helpers) =============
// ==========================================================================
// - simpleHash
// - getCurrentDateString_
// - normalizeProductUrl
// - saveProductsToDriveCache_
// - loadProductsFromDriveCache_
// - isCacheExpired_
// - cosineSimilarity_
// - calculateDynamicThreshold_
// - getQueryEmbedding_
// - callGeminiAPI_
// - getInitialBotData_
// - productMatchesAllAttributes_
// - generateMatchReason_
// - searchProductsBySimilarity_
// - setResponseInCache_
// - getResponseFromCache_
// - isRateLimited_
// - isUrlFetchQuotaExceeded_
// - incrementUrlFetchQuotaCounter_
// - sendJsonpResponse_
// ==========================================================================

// ==========================================================================
// === Test Functions (Optional - Keep for debugging) =======================
// ==========================================================================
/**
 * Test function to update cache.
 */
function runFullCacheUpdate() {
  try {
    clearDriveCache_();
    Utilities.sleep(1000);
    const count = loadProductsAndEmbeddings_();
    Logger.log(`runFullCacheUpdate: Loaded ${count} products.`);
    if (PRODUCT_DATA_CACHE && PRODUCT_DATA_CACHE.products.length > 0) {
      Logger.log(`Sample Product: ${JSON.stringify(PRODUCT_DATA_CACHE.products[0].name)}`);
    } else {
      Logger.log("runFullCacheUpdate: In-memory cache empty.");
    }
  } catch (e) {
    Logger.log(`runFullCacheUpdate: Error: ${e.message}`);
  }
}

/**
 * Test loading from Drive cache.
 */
function testLoadFromDrive() {
  try {
    Logger.log("--- testLoadFromDrive Start ---");

    const cacheData = loadProductsFromDriveCache_();
    if (cacheData && cacheData.products) {
      Logger.log(`testLoadFromDrive: Loaded ${cacheData.products.length} products.`);
      Logger.log(`Timestamp: ${new Date(cacheData.timestamp).toISOString()}`);
      Logger.log(`Sample: ${cacheData.products[0]?.name || 'N/A'}`);
      PRODUCT_DATA_CACHE = { products: cacheData.products };
      CACHE_TIMESTAMP = cacheData.timestamp;
    } else {
      Logger.log("testLoadFromDrive: Failed to load cache.");
    }
    Logger.log("--- testLoadFromDrive End ---");
  } catch (e) {
    Logger.log(`testLoadFromDrive: Error: ${e.message}`);
  }
}

/**
 * Test function to validate Google Sheet data for specific products.
 */
function testProductData() {
  Logger.log("--- testProductData Start ---");
  try {
    const SPREADSHEET_ID_PROPERTY = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
    const sheetName = PropertiesService.getScriptProperties().getProperty(SHEET_NAME_PROPERTY);
    if (!SPREADSHEET_ID_PROPERTY || !sheetName) {
      Logger.log("testProductData: Spreadsheet ID or Sheet Name not configured.");
      return;
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_PROPERTY);
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`testProductData: Sheet "${sheetName}" not found.`);
      return;
    }

    const data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) {
      Logger.log(`testProductData: No data in sheet "${sheetName}".`);
      return;
    }

    const headers = data[0].map(h => (h || '').toString().toLowerCase().trim().replace(/\s+/g, '_'));
    const nameIdx = headers.indexOf('title') !== -1 ? headers.indexOf('title') : headers.findIndex(h => h.includes('name'));
    const embeddingIdx = headers.indexOf(EMBEDDING_COLUMN_HEADER);
    if (nameIdx === -1 || embeddingIdx === -1) {
      Logger.log(`testProductData: Missing columns: ${nameIdx === -1 ? 'title/name' : ''} ${embeddingIdx === -1 ? EMBEDDING_COLUMN_HEADER : ''}`);
      return;
    }

    const targetProducts = [
      "Borghese Energia Retinol Renewal Night Oil",
      "Omnilux Blemish Eraser"
    ];

    let foundCount = 0;
    let invalidEmbeddingCount = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = row[nameIdx] ? row[nameIdx].toString().trim() : '';
      if (targetProducts.includes(name)) {
        foundCount++;
        const embeddingRaw = row[embeddingIdx];
        let embeddingValid = false;
        if (embeddingRaw && typeof embeddingRaw === 'string' && embeddingRaw.trim().startsWith('[')) {
          try {
            const embedding = JSON.parse(embeddingRaw);
            if (Array.isArray(embedding) && embedding.length === MAX_EMBEDDING_DIMENSIONS && embedding.every(n => typeof n === 'number')) {
              embeddingValid = true;
            }
          } catch (e) {
            Logger.log(`testProductData: Invalid embedding for "${name}": ${e.message}`);
          }
        }
        Logger.log(`testProductData: Product "${name}" - Embedding ${embeddingValid ? 'Valid' : 'Invalid'}`);
        if (!embeddingValid) invalidEmbeddingCount++;
      }
    }

    Logger.log(`testProductData: Found ${foundCount}/${targetProducts.length} target products. Invalid embeddings: ${invalidEmbeddingCount}.`);
    if (foundCount < targetProducts.length) {
      Logger.log("testProductData: Missing products. Check Google Sheet data.");
    }
    Logger.log("--- testProductData End ---");
  } catch (e) {
    Logger.log(`testProductData: Error: ${e.message}`);
  }
}

/**
 * Test search function.
 */
function testSearch() {
  try {
    Logger.log("--- testSearch Start ---");
    if (!PRODUCT_DATA_CACHE || isCacheExpired_()) {
      Logger.log("testSearch: Loading from Drive...");
      testLoadFromDrive();
    }

    if (!PRODUCT_DATA_CACHE || !PRODUCT_DATA_CACHE.products || PRODUCT_DATA_CACHE.products.length === 0) {
      Logger.log("testSearch: No product data.");
      return;
    }

    const testQuery = "Borghese Energia Retinol Renewal Night Oil";
    const apiKey = PropertiesService.getScriptProperties().getProperty(GEMINI_API_KEY_PROPERTY);
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const results = searchProductsBySimilarity_(
      testQuery,
      5,
      { product_type: 'night oil', attributes: ['Borghese', 'Energia', 'Retinol', 'Renewal'] },
      apiKey
    );

    Logger.log(`testSearch: Found ${results.length} products for "${testQuery}".`);
    if (results.length > 0) {
      Logger.log(`Top Result: ${JSON.stringify(results[0].name)} Score: ${results[0].score.toFixed(4)}`);
    }
    Logger.log("--- testSearch End ---");
  } catch (e) {
    Logger.log(`testSearch: Error: ${e.message}`);
  }
}

/**
 * Clears Drive cache file and property.
 */
function clearDriveCache_() {
  const properties = PropertiesService.getScriptProperties();
  const fileId = properties.getProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
  let cleared = false;

  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      Logger.log(`clearDriveCache_: Trashed file ID: ${fileId}`);
      cleared = true;
    } catch (e) {
      Logger.log(`clearDriveCache_: Error trashing ID ${fileId}: ${e.message}`);
    }
    properties.deleteProperty(DRIVE_CACHE_FILE_ID_PROPERTY);
  }

  CACHE_TIMESTAMP = null;

  if (!cleared) {
    const files = DriveApp.getFilesByName(DRIVE_CACHE_FILENAME);
    let count = 0;
    while (files.hasNext()) {
      files.next().setTrashed(true);
      count++;
    }
    if (count > 0) {
      Logger.log(`clearDriveCache_: Trashed ${count} files named ${DRIVE_CACHE_FILENAME}`);
    }
  }
}
function testQuotaIncrement() {
    Logger.log("Current quota exceeded status:", isUrlFetchQuotaExceeded_());
    Logger.log("Incrementing quota...");
    incrementUrlFetchQuotaCounter_();
     Logger.log("New quota exceeded status:", isUrlFetchQuotaExceeded_());
     // Note: Reading property immediately after setting might not reflect perfectly due to potential async nature
}
function testRateLimit() {
    const testId = 'test_user_123';
    Logger.log(`Testing rate limit for ${testId}`);
    for (let i = 0; i < 20; i++) {
        Logger.log(`Request ${i+1}: Limited? ${isRateLimited_(testId)}`);
        if (i % 5 === 0) Utilities.sleep(500); // Short pause
    }
}
// ==========================================================================


function precomputeQueryEmbeddings() {
  const apiKey = PropertiesService.getScriptProperties().getProperty(GEMINI_API_KEY_PROPERTY);
  // --- Replace with your actual Spreadsheet ID and Sheet Name ---
  const spreadsheetId = "1gwxWesXxuwdex56nPVlYnL7i04sizApE4jVDoxYwqJ8"; // <<< CHANGE THIS
  const sheetName = "CommonQueries";           // <<< CHANGE THIS (if needed)
  // -------------------------------------------------------------

  // Comprehensive list of common beauty queries
  const queries = [
    // --- Greetings & General ---
    "hello", "hi", "hey",
    "beauty recommendations", "product suggestions",
    "what's new?", "new arrivals",
    "best sellers", "popular products",
    "sales", "discounts", "promotions",
    "gift ideas", "beauty gifts",

    // --- Skincare: Cleansers ---
    "cleanser", "face wash",
    "cleanser for dry skin", "hydrating cleanser",
    "cleanser for oily skin", "clarifying cleanser",
    "cleanser for sensitive skin", "gentle cleanser",
    "cleanser for acne prone skin",
    "cleansing oil", "oil cleanser",
    "cleansing balm",
    "micellar water",
    "gel cleanser", "foam cleanser", "cream cleanser",
    "exfoliating cleanser",

    // --- Skincare: Toners & Essences ---
    "toner", "face toner",
    "hydrating toner",
    "toner for oily skin",
    "toner for sensitive skin",
    "essence", "facial essence",

    // --- Skincare: Serums & Treatments ---
    "serum", "face serum",
    "hydrating serum", "hyaluronic acid serum",
    "vitamin C serum", "brightening serum",
    "retinol serum", "anti aging serum",
    "niacinamide serum",
    "serum for sensitive skin",
    "serum for oily skin",
    "serum for dry skin",
    "acne treatment", "spot treatment",
    "salicylic acid treatment", "BHA serum",
    "glycolic acid serum", "AHA serum",
    "peptide serum",
    "face oil",

    // --- Skincare: Moisturizers ---
    "moisturizer", "face cream", "face lotion",
    "moisturizer for dry skin", "rich moisturizer",
    "moisturizer for oily skin", "oil free moisturizer", "gel moisturizer",
    "moisturizer for sensitive skin", "fragrance free moisturizer",
    "moisturizer for combination skin",
    "moisturizer with SPF",
    "night cream",
    "anti aging moisturizer",
    "lightweight moisturizer",
    "non comedogenic moisturizer",

    // --- Skincare: Eye Care ---
    "eye cream",
    "hydrating eye cream",
    "anti aging eye cream", "eye cream for wrinkles",
    "eye cream for dark circles", "brightening eye cream",
    "eye serum",

    // --- Skincare: Masks & Exfoliators ---
    "face mask",
    "hydrating mask", "sheet mask",
    "clay mask", "detoxifying mask",
    "exfoliating mask", "peel off mask",
    "sleeping mask", "overnight mask",
    "exfoliator", "face scrub",
    "chemical exfoliant", "AHA exfoliant", "BHA exfoliant",
    "gentle exfoliant",

    // --- Skincare: Sunscreen ---
    "sunscreen", "SPF", "sunblock",
    "face sunscreen", "body sunscreen",
    "mineral sunscreen", "zinc oxide sunscreen", "titanium dioxide sunscreen",
    "chemical sunscreen",
    "SPF 30", "SPF 50",
    "sunscreen for sensitive skin",
    "sunscreen for oily skin", "non greasy sunscreen",

    // --- Skincare: Lip Care ---
    "lip balm", "lip treatment", "lip mask",
    "hydrating lip balm", "lip balm with SPF",

    // --- Haircare: Shampoo & Conditioner ---
    "shampoo", "conditioner",
    "shampoo for dry hair", "moisturizing shampoo",
    "shampoo for oily hair", "clarifying shampoo",
    "shampoo for damaged hair", "repairing shampoo",
    "shampoo for fine hair", "volumizing shampoo",
    "shampoo for color treated hair", "color safe shampoo",
    "sulfate free shampoo",
    "conditioner for dry hair", "hydrating conditioner",
    "conditioner for damaged hair",
    "conditioner for fine hair", "lightweight conditioner",
    "leave in conditioner",

    // --- Haircare: Treatments & Styling ---
    "hair mask", "deep conditioner",
    "hair oil", "hair serum",
    "heat protectant spray",
    "dry shampoo",
    "hairspray", "mousse", "hair gel", "styling cream",
    "volumizing spray", "texturizing spray",
    "scalp treatment", "dandruff shampoo",

    // --- Makeup: Face ---
    "foundation",
    "liquid foundation", "powder foundation", "cream foundation", "stick foundation",
    "foundation for dry skin", "hydrating foundation", "dewy foundation",
    "foundation for oily skin", "matte foundation", "long lasting foundation",
    "foundation for sensitive skin",
    "full coverage foundation", "medium coverage foundation", "light coverage foundation",
    "foundation with SPF",
    "concealer",
    "concealer for dark circles", "concealer for blemishes",
    "hydrating concealer", "full coverage concealer",
    "face primer", "makeup primer",
    "mattifying primer", "hydrating primer", "pore minimizing primer",
    "setting powder", "finishing powder", "translucent powder",
    "setting spray", "makeup setting spray",

    // --- Makeup: Cheeks ---
    "blush",
    "powder blush", "cream blush", "liquid blush",
    "bronzer",
    "powder bronzer", "cream bronzer",
    "highlighter",
    "powder highlighter", "liquid highlighter", "cream highlighter",

    // --- Makeup: Eyes ---
    "eyeshadow", "eyeshadow palette",
    "neutral eyeshadow palette",
    "cream eyeshadow", "liquid eyeshadow",
    "eyeliner",
    "pencil eyeliner", "liquid eyeliner", "gel eyeliner",
    "waterproof eyeliner", "black eyeliner", "brown eyeliner",
    "mascara",
    "volumizing mascara", "lengthening mascara", "waterproof mascara",
    "mascara for sensitive eyes",
    "eyeshadow primer",
    "eyebrow pencil", "eyebrow gel", "eyebrow powder", "eyebrow pomade",
    "clear brow gel",

    // --- Makeup: Lips ---
    "lipstick",
    "matte lipstick", "satin lipstick", "cream lipstick", "sheer lipstick",
    "liquid lipstick", "long lasting lipstick",
    "nude lipstick", "red lipstick", "pink lipstick",
    "lip gloss",
    "clear lip gloss", "shimmer lip gloss",
    "lip liner",
    "lip stain",

    // --- Body Care ---
    "body wash", "shower gel",
    "hydrating body wash", "body wash for sensitive skin",
    "body lotion", "body cream", "body butter",
    "body lotion for dry skin",
    "body scrub", "exfoliating body scrub",
    "hand cream", "foot cream",
    "deodorant", "natural deodorant",

    // --- Fragrance ---
    "perfume", "fragrance", "cologne",
    "eau de parfum", "eau de toilette",
    "floral perfume", "fresh perfume", "woody perfume", "oriental perfume",
    "body mist", "fragrance mist",
    "rollerball perfume",

    // --- Tools & Accessories ---
    "makeup brushes", "brush set",
    "foundation brush", "powder brush", "blush brush", "eyeshadow brush",
    "makeup sponge", "beauty blender",
    "eyelash curler",
    "tweezers",
    "hair dryer", "blow dryer",
    "curling iron", "curling wand",
    "hair straightener", "flat iron",
    "hair brush", "comb",

    // --- Attribute/Preference Based ---
    "vegan products", "vegan skincare", "vegan makeup", "vegan haircare",
    "cruelty free products", "cruelty free skincare", "cruelty free makeup",
    "clean beauty", "natural skincare", "organic products",
    "paraben free", "sulfate free", "silicone free", "fragrance free",
    "non comedogenic", "oil free",
    "products for sensitive skin",
    "products for dry skin",
    "products for oily skin",
    "products for acne prone skin",
    "anti aging products",
    "hydrating products",
    "brightening products",

    // --- How-to Questions ---
    "how to apply foundation",
    "how to use serum",
    "how to apply liquid eyeliner",
    "how to use a face mask",
    "how to contour",
    "how to do winged eyeliner",
    "how to choose foundation shade",
    "skincare routine order",
    "how to wash makeup brushes",
    "how to use retinol",
    "how to use vitamin C serum",

    // --- Price Related ---
    "affordable skincare", "budget friendly makeup",
    "products under $20", "products under $50",
    "luxury beauty",

    // --- Specific Ingredients ---
    "products with hyaluronic acid",
    "products with vitamin C",
    "products with retinol",
    "products with niacinamide",
    "products with salicylic acid",
    "products with glycolic acid",
    "products with ceramides",
    "products with peptides",
    "products with SPF"
  ];

  // --- Get Sheet and Clear ---
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`ERROR: Sheet "${sheetName}" not found in Spreadsheet ID "${spreadsheetId}". Cannot precompute embeddings.`);
      return;
    }
    sheet.clearContents(); // Clear only content, keep formatting if any
    sheet.appendRow(["Query", "Embedding"]); // Add header row back
    Logger.log(`Cleared sheet "${sheetName}" and added header.`);
  } catch (e) {
    Logger.log(`ERROR accessing or clearing sheet: ${e.message}`);
    return; // Stop if sheet access fails
  }

  // --- Generate and Append Embeddings ---
  let successCount = 0;
  let errorCount = 0;
  const totalQueries = queries.length;

  Logger.log(`Starting embedding generation for ${totalQueries} queries...`);

  queries.forEach((query, index) => {
    // Check quota before each call (important for large lists)
    if (isUrlFetchQuotaExceeded_()) {
        Logger.log(`WARNING: UrlFetch quota exceeded during precomputation at query ${index + 1}/${totalQueries} ("${query}"). Stopping early.`);
        // Break the loop or stop processing further queries
        // Note: forEach cannot be broken directly, but we can skip processing
        errorCount = totalQueries - index; // Mark remaining as errors/skipped
        return; // Effectively stops processing for this iteration, but loop continues
    }
    // Check rate limit (less likely to hit with sleep, but good practice)
    // let rateLimitIdentifier = 'precompute_process'; // Use a generic ID
    // if (isRateLimited_(rateLimitIdentifier)) {
    //    Logger.log(`Rate limit hit during precomputation for "${query}". Skipping.`);
    //    errorCount++;
    //    Utilities.sleep(5000); // Wait longer if rate limited
    //    return;
    // }

    try {
      Logger.log(`Embedding query ${index + 1}/${totalQueries}: "${query}"`);
      // getQueryEmbedding_ handles its own caching and quota incrementing
      const embedding = getQueryEmbedding_(query, apiKey);
      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        // Validate embedding structure before stringifying
        if (embedding.length === MAX_EMBEDDING_DIMENSIONS && embedding.every(n => typeof n === 'number' && isFinite(n))) {
            sheet.appendRow([query, JSON.stringify(embedding)]);
            successCount++;
        } else {
             Logger.log(`ERROR: Invalid embedding structure received for "${query}". Length: ${embedding.length}. Skipping.`);
             errorCount++;
        }
      } else {
        Logger.log(`WARNING: Failed to get valid embedding for "${query}". Skipping.`);
        errorCount++;
      }
      // Respect API rate limits - 1100ms is safe for ~54 requests/minute
      Utilities.sleep(1100);
    } catch (e) {
      Logger.log(`ERROR embedding query "${query}": ${e.message}`);
      errorCount++;
      // Optional: Add a longer sleep after an error
      Utilities.sleep(2000);
    }
  });

  Logger.log(`--- Precomputation Complete ---`);
  Logger.log(`Successfully embedded: ${successCount}/${totalQueries}`);
  Logger.log(`Failed/Skipped: ${errorCount}/${totalQueries}`);
  if (errorCount > 0) {
      Logger.log(`Check logs for specific errors. Quota might have been exceeded.`);
  }
}

/**
 * Retrieves a precomputed embedding from the "CommonQueries" sheet if a similar query exists.
 * @param {string} query The user's query (should be lowercased).
 * @return {Array<number>|null} The embedding array if found and valid, otherwise null.
 */
function getPrecomputedEmbedding_(query) {
  const functionName = 'getPrecomputedEmbedding_';
  Logger.log(`${functionName}: Attempting to find precomputed embedding for query "${query.substring(0, 50)}..."`);
  const startTime = Date.now();

  // --- Get Config ---
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheetId = scriptProperties.getProperty('PRECOMPUTED_QUERIES_SPREADSHEET_ID'); // Use the new property key
  const sheetName = "CommonQueries"; // Hardcoded sheet name

  if (!spreadsheetId) {
    Logger.log(`${functionName}: ERROR - Script Property "PRECOMPUTED_QUERIES_SPREADSHEET_ID" is not set.`);
    return null;
  }

  // --- Read Sheet Data ---
  let sheetData;
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`${functionName}: ERROR - Sheet "${sheetName}" not found in Spreadsheet ID "${spreadsheetId}".`);
      return null;
    }
    // Get all data except header row
    sheetData = sheet.getDataRange().getValues();
    if (sheetData.length < 2) {
        Logger.log(`${functionName}: No data found in "${sheetName}" sheet.`);
        return null;
    }
    sheetData.shift(); // Remove header row
  } catch (e) {
    Logger.log(`${functionName}: ERROR accessing precomputed queries sheet: ${e.message}`);
    return null;
  }

  // --- Find Best Match ---
  const queryWords = new Set(query.split(/\s+/).filter(w => w.length > 1)); // Use a Set for faster checks
  if (queryWords.size === 0) return null; // Cannot match empty query

  let bestMatchEmbeddingString = null;
  let highestScore = 0;
  const SIMILARITY_MATCH_THRESHOLD = 0.7; // Require a decent overlap

  for (const row of sheetData) {
    const storedQuery = (row[0] || '').toLowerCase(); // Query is in column A (index 0)
    const storedEmbeddingString = row[1] || ''; // Embedding JSON is in column B (index 1)

    if (!storedQuery || !storedEmbeddingString || !storedEmbeddingString.startsWith('[')) {
      continue; // Skip invalid rows
    }

    const storedQueryWords = new Set(storedQuery.split(/\s+/).filter(w => w.length > 1));
    if (storedQueryWords.size === 0) continue;

    // Calculate Jaccard-like similarity (intersection over union approximation)
    let intersectionSize = 0;
    queryWords.forEach(word => {
      if (storedQueryWords.has(word)) {
        intersectionSize++;
      }
    });

    const unionSize = queryWords.size + storedQueryWords.size - intersectionSize;
    const score = unionSize > 0 ? intersectionSize / unionSize : 0;

    // Check if this is a better match above the threshold
    if (score > highestScore && score >= SIMILARITY_MATCH_THRESHOLD) {
      highestScore = score;
      bestMatchEmbeddingString = storedEmbeddingString;
      // Optional: Log the match found
      // Logger.log(`${functionName}: Potential match found - Score: ${score.toFixed(3)}, Stored Query: "${storedQuery}"`);
    }
  } // End loop through sheet rows

  // --- Process Best Match ---
  if (bestMatchEmbeddingString) {
    try {
      const parsedEmbedding = JSON.parse(bestMatchEmbeddingString);
      // Validate the parsed embedding
      if (Array.isArray(parsedEmbedding) && parsedEmbedding.length === MAX_EMBEDDING_DIMENSIONS && parsedEmbedding.every(n => typeof n === 'number' && isFinite(n))) {
        const duration = Date.now() - startTime;
        Logger.log(`${functionName}: Found and validated precomputed embedding. Score: ${highestScore.toFixed(3)}. Duration: ${duration}ms.`);
        return parsedEmbedding;
      } else {
        Logger.log(`${functionName}: ERROR - Best match embedding string was invalid JSON or structure. Score: ${highestScore.toFixed(3)}`);
      }
    } catch (e) {
      Logger.log(`${functionName}: ERROR parsing best match embedding JSON: ${e.message}. Score: ${highestScore.toFixed(3)}`);
    }
  }

  // --- No Match Found ---
  const duration = Date.now() - startTime;
  Logger.log(`${functionName}: No suitable precomputed embedding found. Duration: ${duration}ms.`);
  return null;
}
