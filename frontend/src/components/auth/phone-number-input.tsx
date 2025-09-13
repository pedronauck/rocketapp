import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Phone } from 'lucide-react';

interface PhoneNumberInputProps {
  onSubmit: (phoneNumber: string) => Promise<void>;
  isLoading?: boolean;
  error?: string;
  validatePhoneNumber: (phone: string) => string | null;
  formatPhoneNumber: (phone: string) => string;
}

export function PhoneNumberInput({
  onSubmit,
  isLoading = false,
  error,
  validatePhoneNumber,
  formatPhoneNumber,
}: PhoneNumberInputProps) {
  const [phone, setPhone] = useState('');
  const [validationError, setValidationError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = validatePhoneNumber(phone);
    if (validation) {
      setValidationError(validation);
      return;
    }

    setValidationError('');
    
    try {
      await onSubmit(phone);
    } catch (err) {
      console.error('Phone submission error:', err);
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value);
    if (validationError) {
      setValidationError('');
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center shadow-lg">
          <Phone className="h-8 w-8 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Pokédex Call Center
          </h1>
          <h2 className="text-lg font-semibold text-foreground mt-1">Sign In</h2>
        </div>
        <p className="text-muted-foreground">
          Access your Pokémon query history by entering your phone number
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="(555) 123-4567 or +1 555 123 4567"
            disabled={isLoading}
            className="text-center"
          />
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
          {phone && !validationError && (
            <p className="text-sm text-muted-foreground">
              Formatted: {formatPhoneNumber(phone)}
            </p>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-primary-foreground shadow-lg" disabled={isLoading || !phone}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending Code...
            </>
          ) : (
            'Send Verification Code'
          )}
        </Button>
      </form>
    </div>
  );
}