/**
 * API Client for backend communication
 * Handles all HTTP requests with error handling and response formatting
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Make an API request
 * @param {string} endpoint - API endpoint (e.g., '/renewals/alerts')
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} Response data
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };
  
  try {
    const response = await fetch(url, finalOptions);
    
    // Parse response
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    
    // Handle errors
    if (!response.ok) {
      throw new APIError(
        data?.message || `HTTP ${response.status}`,
        response.status,
        data
      );
    }
    
    return data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    
    // Network error or parsing error
    throw new APIError(
      error.message || 'Network error',
      0,
      null
    );
  }
}

/**
 * GET request
 */
export async function get(endpoint, options = {}) {
  return request(endpoint, {
    ...options,
    method: 'GET',
  });
}

/**
 * POST request
 */
export async function post(endpoint, body, options = {}) {
  return request(endpoint, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * PUT request
 */
export async function put(endpoint, body, options = {}) {
  return request(endpoint, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * PATCH request
 */
export async function patch(endpoint, body, options = {}) {
  return request(endpoint, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * DELETE request
 */
export async function del(endpoint, options = {}) {
  return request(endpoint, {
    ...options,
    method: 'DELETE',
  });
}

/**
 * Renewal API endpoints
 */
export const renewalAPI = {
  /**
   * Get all renewal alerts
   * @param {object} params - Query parameters (page, limit, priority, status, search)
   */
  getAlerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return get(`/renewals/alerts${query ? `?${query}` : ''}`);
  },
  
  /**
   * Get renewal alert detail
   * @param {string} caseId - Case ID
   */
  getAlert: (caseId) => get(`/renewals/${caseId}`),
  
  /**
   * Update renewal alert
   * @param {string} caseId - Case ID
   * @param {object} data - Update data (status, notes, etc.)
   */
  updateAlert: (caseId, data) => put(`/renewals/${caseId}`, data),
};

/**
 * Retro Enrollment API endpoints
 */
export const retroAPI = {
  /**
   * Get all retro enrollment cases
   * @param {object} params - Query parameters (page, limit, status, step, search)
   */
  getCases: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return get(`/retro${query ? `?${query}` : ''}`);
  },
  
  /**
   * Get retro case detail
   * @param {string} caseId - Case ID
   */
  getCase: (caseId) => get(`/retro/${caseId}`),
  
  /**
   * Update retro case
   * @param {string} caseId - Case ID
   * @param {object} data - Update data (current_step, notes, etc.)
   */
  updateCase: (caseId, data) => put(`/retro/${caseId}`, data),
};

/**
 * Metrics API endpoints
 */
export const metricsAPI = {
  /**
   * Get dashboard metrics
   */
  getMetrics: () => get('/metrics'),
};

export { APIError };
