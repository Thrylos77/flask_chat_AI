// Function to clone an answer block template
// and append it to the output area
function cloneAnswerBlock(){
    const output = document.querySelector('#gpt-output');
    const template = document.querySelector('#chat-template');
    const clone = template.cloneNode(true);
    clone.id = "";
    output.appendChild(clone);
    clone.classList.remove('hidden');
    return clone.querySelector('.message');
}

// Function to add a message to the chat log
function addToLog(message){
    const answerBlock = cloneAnswerBlock();
    answerBlock.innerText = message;
    return answerBlock;
}

function getChatHistory() {
    const messagesBlocks = document.querySelectorAll('.message:not(#chat-template .message)');
    // Using Array.from to convert NodeList to Array and map to extract innerHTML
    return Array.from(messagesBlocks).map(message => message.innerHTML);
}

async function fetchPromptResponse() {
    const response = await fetch('/prompt', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({"chatHistory": getChatHistory()})
    })

    return response.body.getReader();
}

async function readResponseChunks(reader, answerBlock) {
    const decoder = new TextDecoder();
    const converter = new showdown.Converter();

    let chunks = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            return;
        }
        chunks += decoder.decode(value);
        answerBlock.innerHTML = converter.makeHtml(chunks);
    }
}

// Event listener for the form in the html
document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('#prompt-form');
    const spinnerIcon = document.querySelector('#spinner-icon');
    const sendIcon = document.querySelector('#send-icon');

    form.addEventListener("submit", async (event) => {
        event.preventDefault(); // Prevent default form submission
        spinnerIcon.classList.remove('hidden');
        sendIcon.classList.add('hidden');

        const prompt = form.elements.prompt.value;
        form.elements.prompt.value = ""; // Clear the input field
        addToLog(prompt);

        try {
            const answerBlock = addToLog("...");
            const reader = await fetchPromptResponse();
            await readResponseChunks(reader, answerBlock);
        } catch (error) {
            console.error("Error fetching prompt response:", error);
        } finally {
            spinnerIcon.classList.add('hidden');
            sendIcon.classList.remove('hidden');
            hljs.highlightAll();
        }
    })

});