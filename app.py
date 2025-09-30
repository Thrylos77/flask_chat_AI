import os
import logging
from typing import List, Dict, Generator
from dotenv import load_dotenv
from flask import Flask, render_template, request, Response, jsonify
from openai import OpenAI
import bleach
import traceback

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

# Vérification de la clé API
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    logger.error("OPENAI_API_KEY non trouvée dans les variables d'environnement")
    raise ValueError("Clé API OpenAI manquante")

client = OpenAI(api_key=api_key)

app = Flask(__name__)

# Configuration pour la sécurité
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

# Tags autorisés pour le nettoyage HTML
ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote']
ALLOWED_ATTRIBUTES = {'code': ['class'], 'pre': ['class']}

@app.route("/")
def home():
    return render_template('index.html')

@app.route("/prompt", methods=["POST"])
def prompt():
    try:
        data = request.get_json()
        if not data or "chatHistory" not in data:
            return jsonify({"error": "Données de chat manquantes"}), 400
        
        messages = data["chatHistory"]
        
        # Validation des messages
        if len(messages) > 100:  # Limite augmentée mais raisonnable
            messages = messages[-100:]
        
        # Validation et nettoyage du contenu
        cleaned_messages = []
        for msg in messages:
            if isinstance(msg, str) and len(msg.strip()) > 0:
                # Nettoyage HTML basique
                clean_msg = bleach.clean(msg, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES)
                if len(clean_msg) <= 8000:  # Limite augmentée
                    cleaned_messages.append(clean_msg)
        
        if not cleaned_messages:
            return jsonify({"error": "Aucun message valide"}), 400
        
        conversation = build_conversation_dict(cleaned_messages)
        
        return Response(
            event_stream(conversation), 
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-Accel-Buffering': 'no'  # Nginx compatibility
            }
        )
    
    except Exception as e:
        logger.error(f"Erreur lors du traitement de la requête: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Erreur interne du serveur"}), 500

def build_conversation_dict(messages: List[str]) -> List[Dict[str, str]]:    
    """
    Convertit une liste de messages en un dictionnaire de conversation.
    """
    conversation = []
    for i, message in enumerate(messages):
        role = "user" if i % 2 == 0 else "assistant"
        conversation.append({"role": role, "content": message})
    
    return conversation

def event_stream(conversation: List[Dict[str, str]]) -> Generator[str, None, None]:
    """
    Générateur pour le streaming de la réponse OpenAI avec gestion d'erreurs améliorée
    """
    try:
        # API OpenAI moderne
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=conversation,
            stream=True,
            max_tokens=2000,
            temperature=0.7,
            presence_penalty=0.1,
            frequency_penalty=0.1
        )
        
        content_generated = False
        
        for chunk in response:
            if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                delta = chunk.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    content = delta.content
                    content_generated = True
                    # Escape des caractères spéciaux pour SSE
                    content = content.replace('\n', '\\n').replace('\r', '')
                    yield f"data: {content}\n\n"
        
        if content_generated:
            # Signal de fin
            yield "data: [DONE]\n\n"
        else:
            # Aucun contenu généré
            yield "data: ERROR:Aucune réponse générée par l'IA\n\n"
    
    except Exception as e:
        logger.error(f"Erreur OpenAI: {str(e)}")
        logger.error(traceback.format_exc())
        
        # Messages d'erreur spécifiques selon le type d'exception
        error_message = "Une erreur s'est produite"
        error_str = str(e).lower()
        
        if "insufficient_quota" in error_str or "quota" in error_str:
            error_message = "💳 Quota API dépassé. Vérifiez votre abonnement OpenAI."
        elif "invalid_api_key" in error_str or "unauthorized" in error_str:
            error_message = "🔑 Clé API invalide ou non autorisée."
        elif "rate_limit" in error_str:
            error_message = "⏰ Limite de taux atteinte. Veuillez patienter."
        elif "billing" in error_str:
            error_message = "💳 Problème de facturation. Vérifiez votre compte OpenAI."
        else:
            error_message = f"Erreur technique: {str(e)}"
        
        yield f"data: ERROR:{error_message}\n\n"

@app.errorhandler(413)
def too_large(e):
    logger.warning("Requête trop volumineuse reçue")
    return jsonify({"error": "Requête trop volumineuse"}), 413

@app.errorhandler(429)
def ratelimit_handler(e):
    logger.warning("Limite de taux atteinte")
    return jsonify({"error": "Trop de requêtes. Veuillez patienter."}), 429

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Erreur interne: {str(e)}")
    return jsonify({"error": "Erreur interne du serveur"}), 500

@app.before_request
def log_request_info():
    """Log des informations de requête pour le débogage"""
    if request.endpoint == 'prompt':
        logger.info(f"Nouvelle requête chat depuis {request.remote_addr}")

@app.after_request
def after_request(response):
    """Headers de sécurité et CORS"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_openai_connection():
    """Valide la connexion à l'API OpenAI au démarrage"""
    try:
        # Test simple de la connexion
        client.models.list()
        logger.info("✅ Connexion à l'API OpenAI validée")
        return True
    except Exception as e:
        logger.error(f"❌ Impossible de se connecter à l'API OpenAI: {str(e)}")
        return False

if __name__ == '__main__':
    # Validation de la connexion OpenAI au démarrage
    if not validate_openai_connection():
        logger.error("🚨 Démarrage interrompu: problème de connexion à l'API OpenAI")
        exit(1)
    
    # Configuration de production recommandée
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_PORT', 5000))
    
    logger.info(f"🚀 Démarrage de FlaskGPT sur {host}:{port}")
    logger.info(f"🔧 Mode debug: {debug_mode}")
    
    app.run(
        debug=debug_mode, 
        host=host, 
        port=port,
        threaded=True  # Important pour les streams
    )