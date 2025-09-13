# Frontend - Pokemon Query History with Phone Authentication

A React frontend application that integrates with Twilio phone authentication to display Pokemon query history from the voice service.

## Features

- 📱 **Phone Authentication** - Twilio Verify SMS-based login
- 🔍 **Pokemon Query History** - View all Pokemon you've asked about via phone
- 📊 **Usage Statistics** - Track your most queried Pokemon and call statistics
- 🎨 **Pokedex Design** - Beautiful UI styled according to Figma designs
- 🌙 **Dark/Light Mode** - Theme switching support
- 📱 **Responsive Design** - Works on mobile, tablet, and desktop

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **TanStack Query** - API state management
- **React Hook Form** - Form handling
- **Zod** - Schema validation

## Development Setup

### Prerequisites

- Node.js 18+ or Bun
- Backend server running on `http://localhost:3005`

### Installation

```bash
# Install dependencies
bun install
# or npm install

# Start development server
bun run dev
# or npm run dev
```

The frontend will be available at `http://localhost:5173`

### Backend Connection

The frontend connects to the backend API at `http://localhost:3005`. Make sure the backend server is running before starting the frontend.

## Authentication Flow

### Development Mode

When the backend is in development mode (no Twilio credentials configured):

1. Enter any valid phone number (e.g., `+15551234567`)
2. Click "Send Code"
3. Use the development code: `123456`
4. You'll be logged in and can view Pokemon queries

### Production Mode

With Twilio configured:

1. Enter your real phone number
2. Click "Send Code"
3. Check your phone for the SMS verification code
4. Enter the 6-digit code
5. You'll be authenticated and can access your Pokemon history

## API Integration

The frontend integrates with these backend endpoints:

### Authentication
- `POST /api/auth/send-verification` - Send SMS verification code
- `POST /api/auth/verify` - Verify code and login
- `GET /api/auth/session` - Check authentication status
- `POST /api/auth/logout` - Logout

### Pokemon Queries
- `GET /api/pokemon-queries` - Get paginated query history
- `GET /api/pokemon-queries/:callSid` - Get specific query details
- `GET /api/pokemon-queries/stats` - Get user statistics

## Project Structure

```
src/
├── components/
│   ├── ui/                 # Shadcn UI components
│   ├── auth/              # Authentication components
│   ├── pokemon/           # Pokemon-related components
│   ├── theme-provider.tsx # Theme context
│   └── theme-toggle.tsx   # Dark/light mode toggle
├── hooks/                 # Custom React hooks
├── lib/
│   └── utils.ts          # Utility functions
├── pages/                # Page components
└── App.tsx              # Main app component
```

## Available Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run lint` - Run ESLint
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check code formatting

## Environment Variables

Create a `.env.local` file for frontend-specific configuration:

```env
# Backend API URL (optional, defaults to http://localhost:3005)
VITE_API_URL=http://localhost:3005
```

## Features in Development

### Phase 3: Frontend Authentication Flow ⏳
- [ ] Phone number input with country code selector
- [ ] OTP verification screen
- [ ] Protected route wrapper
- [ ] Auth context and hooks

### Phase 4: Pokemon History Display ⏳
- [ ] Pokemon list/grid view
- [ ] Individual Pokemon cards
- [ ] Search and filtering
- [ ] Query details modal

### Phase 5: Figma Design Implementation ⏳
- [ ] Import design tokens from Figma
- [ ] Apply Pokedex styling
- [ ] Responsive design implementation
- [ ] Animation integration

## Current Status

✅ **Backend Integration Complete**
- Authentication API endpoints implemented
- Pokemon query API ready
- JWT token management
- Rate limiting and security

⏳ **Frontend Development Needed**
- UI components for authentication
- Pokemon history display
- Figma design implementation

## Design Reference

The UI will be styled according to the Figma design:
https://www.figma.com/design/R6bPTobXTSOaCkfqhcEQGE/Pokédex--Community-?node-id=1016-1461

## Contributing

1. Follow the existing code style and conventions
2. Use TypeScript with strict mode
3. Follow Shadcn UI patterns for components
4. Ensure responsive design
5. Test authentication flow thoroughly

## Troubleshooting

### Backend Connection Issues
- Ensure backend server is running on port 3005
- Check CORS configuration allows localhost:5173
- Verify API endpoints are accessible

### Authentication Issues
- In development mode, always use code `123456`
- Check browser console for API errors
- Ensure phone number is in valid format (+1234567890)

### Build Issues
- Clear node_modules and reinstall dependencies
- Check TypeScript errors with `bun run build`
- Verify all imports are correct