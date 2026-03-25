# LavaMessenger - E2E Encrypted Messenger

🔐 Безопасный мессенджер с end-to-end шифрованием.

## Возможности

### Безопасность
- 🔒 AES-256 шифрование сообщений
- 🔑 E2E шифрование (сообщения расшифровываются только на устройствах)
- 🛡️ Perfect Forward Secrecy
- 🔐 Firebase Authentication

### Коммуникация
- 💬 Личные чаты
- 📊 Список пользователей онлайн
- 💬 Отправка сообщений в реальном времени
- 🔔 Уведомления о печатании

### Социальные функции
- 👤 Профили пользователей
- 📷 Аватары
- 📷 Статусы (24 часа)
- ❤️ Реакции к сообщениям
- 🔍 Поиск по истории

### Firebase
- 🔥 Firestore - хранение сообщений
- 📦 Storage - аватары и статусы
- 🔐 Authentication - вход/регистрация

## Установка и запуск

### 1. Настройка Firebase

1. Перейдите в [Firebase Console](https://console.firebase.google.com/)
2. Создайте проект или выберите существующий
3. Включите **Authentication**:
   - Email/Password
4. Включите **Firestore Database**:
   - Создайте базу данных в тестовом режиме
5. Включите **Storage**:
   - Создайте хранилище в тестовом режиме
6. Скопируйте конфигурацию Firebase в `src/firebase.js`

### 2. Правила безопасности Firebase

Добавьте правила в Firebase Console → Firestore → Правила:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    match /users/{userId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if request.auth.uid == userId;
      allow delete: if false;
    }
    
    match /chats/{chatId} {
      allow read: if request.auth != null 
        && request.auth.uid in resource.data.participants;
      allow create: if request.auth != null;
      allow update: if request.auth != null 
        && request.auth.uid in resource.data.participants;
      allow delete: if false;
      
      match /messages/{messageId} {
        allow read: if request.auth != null;
        allow create: if request.auth != null 
          && request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
        allow update: if request.auth != null;
        allow delete: if false;
      }
    }
    
    match /statuses/{statusId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if false;
      allow delete: if request.auth.uid == resource.data.userId;
    }
  }
}
```

### 3. Запуск

```bash
cd securemessenger_web
npm install
npm run dev
```

## Структура проекта

```
securemessenger_web/
├── src/
│   ├── firebase.js          # Firebase конфигурация
│   ├── App.jsx              # Основное приложение
│   ├── App.css              # Стили
│   └── utils/
│       ├── crypto.js        # Функции шифрования
│       └── firebaseService.js # Firebase сервисы
├── firebase-rules.txt       # Правила безопасности Firebase
└── package.json
```

## Технологии

- React + Vite
- Firebase (Auth, Firestore, Storage)
- CryptoJS (AES-256 шифрование)
- CSS3

## Как работает E2E шифрование

1. При регистрации генерируется уникальный сессионный ключ
2. Сообщения шифруются AES-256 перед отправкой в Firebase
3. Только получатель с правильным ключом может расшифровать сообщение
4. Сервер Firebase видит только зашифрованные данные
