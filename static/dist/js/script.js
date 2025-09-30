// Configuration globale
const CONFIG = {
    MAX_MESSAGE_LENGTH: 4000,
    SCROLL_BEHAVIOR: 'smooth',
    TYPING_SPEED: 30
};

class FlaskGPTChat {
    constructor() {
        this.chatHistory = [];
        this.isProcessing = false;
        this.currentStreamMessage = null;
        this.markdownConverter = new showdown.Converter({
            tables: true,
            strikethrough: true,
            tasklists: true,
            ghCodeBlocks: true
        });
        this.initializeElements();
        this.attachEventListeners();
        this.initializeTextarea();
    }

    initializeElements() {
        this.form = document.getElementById('prompt-form');
        this.textarea = document.getElementById('prompt');
        this.sendButton = document.getElementById('send-button');
        this.sendIcon = document.getElementById('send-icon');
        this.spinnerIcon = document.getElementById('spinner-icon');
        this.chatMessages = document.getElementById('chat-messages');
    }

    attachEventListeners() {
        this.form.addEventListener('submit', this.handleSubmit.bind(this));
        this.textarea.addEventListener('keydown', this.handleKeydown.bind(this));
        this.textarea.addEventListener('input', this.handleTextareaInput.bind(this));
    }

    initializeTextarea() {
        // Auto-resize functionality
        this.textarea.style.height = 'auto';
        // Allow vertical scrolling for touchpads and touch devices
        this.textarea.style.overflowY = 'auto';
        // Ensure touch scrolling is enabled
        this.textarea.style.touchAction = 'auto';
    }

    handleKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!this.isProcessing && this.textarea.value.trim()) {
                this.handleSubmit(event);
            }
        }
    }

    handleTextareaInput() {
        // Auto-resize textarea
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
        // Update send button state
        const hasText = this.textarea.value.trim().length > 0;
        this.sendButton.style.opacity = hasText && !this.isProcessing ? '1' : '0.6';
    }

    async handleSubmit(event) {
        event.preventDefault();
        const message = this.textarea.value.trim();
        if (!message || this.isProcessing) return;
        // Validation de la longueur
        if (message.length > CONFIG.MAX_MESSAGE_LENGTH) {
            this.showError(`Message trop long. Maximum ${CONFIG.MAX_MESSAGE_LENGTH} caractères.`);
            return;
        }
        this.setProcessingState(true);
        this.addUserMessage(message);
        this.textarea.value = '';
        this.handleTextareaInput();
        try {
            await this.sendMessageToAPI();
        } catch (error) {
            console.error('Erreur lors de l\'envoi:', error);
            this.showError(error.message || 'Une erreur inattendue s\'est produite.');
        } finally {
            this.setProcessingState(false);
        }
    }

    addUserMessage(message) {
        this.chatHistory.push(message);
        const messageElement = this.createMessageElement(message, 'user');
        this.chatMessages.appendChild(messageElement);
        this.scrollToBottom();
    }

    addAssistantMessage(message) {
        this.chatHistory.push(message);
        const messageElement = this.createMessageElement(message, 'assistant');
        this.chatMessages.appendChild(messageElement);
        return messageElement;
    }

    createMessageElement(content, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;
        if (type === 'user') {
            messageDiv.textContent = content;
        } else {
            messageDiv.innerHTML = this.sanitizeAndFormat(content);
        }
        return messageDiv;
    }

    createLoadingMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-loading';
        messageDiv.innerHTML = `
            <span>Assistant réfléchit</span>
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
        return messageDiv;
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message message-error';
        errorDiv.innerHTML = `
            <strong>❌ Erreur:</strong><br>
            ${this.escapeHtml(message)}
        `;
        this.chatMessages.appendChild(errorDiv);
        this.scrollToBottom();
    }

    async sendMessageToAPI() {
        const loadingMessage = this.createLoadingMessage();
        try {
            const response = await fetch('/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ "chatHistory": this.chatHistory })
            });
            // Supprimer le message de chargement
            loadingMessage.remove();
            if (!response.ok) {
                let errorMessage = "Erreur du serveur";
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                    if (response.status === 401) {
                        errorMessage = "🔑 Clé API non autorisée. Vérifiez votre configuration.";
                    } else if (response.status === 429) {
                        errorMessage = "⏰ Quota API dépassé. Veuillez réessayer plus tard.";
                    } else if (response.status === 402) {
                        errorMessage = "💳 Crédit API insuffisant. Vérifiez votre abonnement OpenAI.";
                    }
                } catch {}
                throw new Error(errorMessage);
            }
            await this.handleStreamResponse(response);
        } catch (error) {
            loadingMessage.remove();
            throw error;
        }
    }

    async handleStreamResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        this.currentStreamMessage = this.createMessageElement('', 'assistant');
        this.chatMessages.appendChild(this.currentStreamMessage);
        this.scrollToBottom();
        let chunks = '';
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            this.finalizeStreamMessage(chunks);
                            return;
                        }
                        if (data.startsWith('ERROR:')) {
                            throw new Error(data.substring(6));
                        }
                        chunks += data;
                        this.updateStreamMessage(chunks);
                    }
                }
            }
            this.finalizeStreamMessage(chunks);
        } catch (error) {
            this.currentStreamMessage.remove();
            throw error;
        }
    }

    updateStreamMessage(content) {
        if (this.currentStreamMessage) {
            this.currentStreamMessage.innerHTML = this.sanitizeAndFormat(content);
            this.scrollToBottom();
        }
    }

    finalizeStreamMessage(content) {
        if (this.currentStreamMessage && content.trim()) {
            this.chatHistory.push(content);
            this.currentStreamMessage.innerHTML = this.sanitizeAndFormat(content);
            hljs.highlightAll();
            this.scrollToBottom();
        } else if (this.currentStreamMessage) {
            this.currentStreamMessage.remove();
            this.showError("Aucune réponse reçue du serveur.");
        }
        this.currentStreamMessage = null;
    }

    sanitizeAndFormat(content) {
        const html = this.markdownConverter.makeHtml(content);
        return this.sanitizeHtml(html);
    }

    sanitizeHtml(html) {
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+="[^"]*"/gi, '')
            .replace(/javascript:/gi, '');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setProcessingState(processing) {
        this.isProcessing = processing;
        this.sendButton.disabled = processing;
        this.textarea.disabled = processing;
        if (processing) {
            this.sendIcon.style.display = 'none';
            this.spinnerIcon.style.display = 'block';
        } else {
            this.sendIcon.style.display = 'block';
            this.spinnerIcon.style.display = 'none';
        }
        this.handleTextareaInput();
    }

    scrollToBottom() {
        requestAnimationFrame(() => {
            this.chatMessages.scrollTo({
                top: this.chatMessages.scrollHeight,
                behavior: CONFIG.SCROLL_BEHAVIOR
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new FlaskGPTChat();
});
