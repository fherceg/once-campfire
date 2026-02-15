import { Controller } from "@hotwired/stimulus"
import FileUploader from "models/file_uploader"
import { onNextEventLoopTick, nextFrame } from "helpers/timing_helpers"
import { escapeHTML } from "helpers/dom_helpers"

export default class extends Controller {
  static classes = ["toolbar"]
  static targets = [ "clientid", "fields", "fileList", "text" ]
  static values = { roomId: Number }
  static outlets = [ "messages" ]

  #files = []

  connect() {
    if (!this.#usingTouchDevice) {
      onNextEventLoopTick(() => this.textTarget.focus())
    }
  }

  submit(event) {
    event.preventDefault()

    if (!this.fieldsTarget.disabled) {
      this.#submitFiles()
      this.#submitMessage()
      this.collapseToolbar()
      this.textTarget.focus()
    }
  }

  submitEnd(event) {
    if (!event.detail.success) {
      this.messagesOutlet.failPendingMessage(this.clientidTarget.value)
    }
  }

  toggleToolbar() {
    this.element.classList.toggle(this.toolbarClass)
    this.textTarget.focus()
  }

  collapseToolbar() {
    this.element.classList.remove(this.toolbarClass)
  }

  replaceMessageContent(content) {
    const editor = this.textTarget.editor

    editor.recordUndoEntry("Format reply")
    editor.setSelectedRange([0, editor.getDocument().toString().length])
    editor.deleteInDirection("forward")
    editor.insertHTML(content)
    editor.setSelectedRange([editor.getDocument().toString().length - 1])
  }

  submitByKeyboard(event) {
    const toolbarVisible = this.element.classList.contains(this.toolbarClass)
    const metaEnter = event.key == "Enter" && (event.metaKey || event.ctrlKey)
    const plainEnter = event.keyCode == 13 && !event.shiftKey && !event.isComposing

    if (!this.#usingTouchDevice && (metaEnter || (plainEnter && !toolbarVisible))) {
      this.submit(event)
    }
  }

  filePicked(event) {
    for (const file of event.target.files) {
     if (!file.type.startsWith("image/")) {
  alert("Only image files are allowed. Videos and documents are not permitted.")
        event.target.value = null
        return
      }
      this.#files.push(file)
    }
    event.target.value = null
    this.#updateFileList()
  }

  fileUnpicked(event) {
    this.#files.splice(event.params.index, 1)
    this.#updateFileList()
  }

 pasteFiles(event) {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault()
    }

    for (const file of event.clipboardData.files) {
      if (!file.type.startsWith("image/")) {
  alert("Only image files are allowed. Videos and documents are not permitted.")
        return
      }
      this.#files.push(file)
    }

    this.#updateFileList()
  }

  dropFiles({ detail: { files } }) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
  alert("Only image files are allowed. Videos and documents are not permitted.")
        return
      }
      this.#files.push(file)
    }

    this.#updateFileList()
  }

  preventAttachment(event) {
    event.preventDefault()
  }

  online() {
    this.fieldsTarget.disabled = false
  }

  offline() {
    this.fieldsTarget.disabled = true
  }

  get #usingTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  async #submitMessage() {
    if (this.#validInput()) {
      const clientMessageId = this.#generateClientId()

      await this.messagesOutlet.insertPendingMessage(clientMessageId, this.textTarget)
      await nextFrame()

      this.clientidTarget.value = clientMessageId
      this.element.requestSubmit()
      this.#reset()
    }
  }

  #validInput() {
    return this.textTarget.textContent.trim().length > 0
  }

  async #submitFiles() {
    const files = this.#files

    this.#files = []
    this.#updateFileList()

    for (let file of files) {
      if (file.type.startsWith("image/")) {
        file = await this.#compressImage(file)
      }
      const clientMessageId = this.#generateClientId()
      const uploader = new FileUploader(file, this.element.action, clientMessageId, this.#uploadProgress.bind(this))

      const body = this.#pendingUploadProgress(file.name)
      await this.messagesOutlet.insertPendingMessage(clientMessageId, body)

      const resp = await uploader.upload()

      Turbo.renderStreamMessage(resp)
    }
  }

  #uploadProgress(percent, clientMessageId, file) {
    const body = this.#pendingUploadProgress(file.name, percent)
    this.messagesOutlet.updatePendingMessage(clientMessageId, body)
  }

  #generateClientId() {
    return Math.random().toString(36).slice(2)
  }

  #reset() {
    this.textTarget.value = ""
  }

  #updateFileList() {
    this.#files.sort((a, b) => a.name.localeCompare(b.name))

    const fileNodes = this.#files.map((file, index) => {
      const filename = file.name.split(".").slice(0, -1).join(".")
      const extension = file.name.split(".").pop()

      const node = document.createElement("button")
      node.setAttribute("type","button")
      node.setAttribute("style","gap: 0")
      node.dataset.action = "composer#fileUnpicked"
      node.dataset.composerIndexParam = index
      node.className = "btn btn--plain composer__file txt-normal position-relative unpad flex-column"
      node.innerHTML = file.type.match(/^image\/.*/) ? `<img role="presentation" class="flex-item-no-shrink composer__file-thumbnail" src="${URL.createObjectURL(file)}">` : `<span class="composer__file-thumbnail composer__file-thumbnail--common colorize--black"></span>`
      node.innerHTML += `<span class="pad-inline txt-small flex align-center max-width composer__file-caption"><span class="overflow-ellipsis">${escapeHTML(filename)}.</span><span class="flex-item-no-shrink">${escapeHTML(extension)}</span></span>`

      return node
    })

    this.fileListTarget.replaceChildren(...fileNodes)
  }

  #pendingUploadProgress(filename, percent=0) {
    return `
      <div class="message__pending-upload flex align-center gap" style="--percentage: ${percent}%">
        <div class="composer__file-thumbnail composer__file-thumbnail--common colorize--black borderless flex-item-no-shrink"></div>
        <div>${escapeHTML(filename)} - <span>${percent}%</span></div>
      </div>
    `
  }
async #compressImage(file) {
    const MAX_SIZE = 0.5 * 1024 * 1024 // 0.5MB
    if (file.size <= MAX_SIZE) return file

    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement("canvas")
        let width = img.width
        let height = img.height
        const scale = Math.sqrt(MAX_SIZE / file.size)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: "image/jpeg" }))
        }, "image/jpeg", 0.85)
      }
      img.src = url
    })
  }
```

Commit the changes.

---

## File 2: `app/models/message/attachment.rb`

This adds a **server-side** safety check (important - never rely on JS alone!).

Go to:
```
https://github.com/fherceg/once-campfire/blob/main/app/models/message/attachment.rb
}
