import os
import openai
from dotenv import load_dotenv
# Chargement des variables d'environnement depuis le fichier .env

from flask import Flask, render_template, request, Response

load_dotenv()  # Charge les variables d'environnement depuis le fichier .env

openai.api_key = os.getenv("OPENAI_API_KEY")

app = Flask(__name__)

@app.route("/")     #Home page
def home():
    return render_template('index.html')

@app.route("/prompt", methods=["POST"])
def prompt():
    messages = request.json["chatHistory"]
    conversation = build_conversation_dict(messages)

    return Response(event_stream(conversation), mimetype='text/event-stream')

def build_conversation_dict(messages: list) -> list[dict]:    
    """
    Convertit une liste de messages en un dictionnaire de conversation.
    """
    return [
        {"role": "user" if i % 2 == 0 else "assistant", "content": message}
        for i, message in enumerate(messages)
    ]

# Appel API à OpenAI pour récupérer la réponse
def event_stream(conversation: list[dict]) -> str:
    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=conversation,
        stream=True     # Activation du mode streaming pour recevoir la réponse en temps réel pour les réponses par morceaux
    )  

    for line in response:
        text = line.choices[0].delta.get('content', '')
        if len(text):
            yield text      # Générateur Yield pour envoyer des morceaux de texte au fur et à mesure


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)