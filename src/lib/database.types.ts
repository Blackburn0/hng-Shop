// Mirrors supabase/migrations/*. Written by hand to match `supabase gen types`
// output; regenerate with `npm run db:types` after `supabase link` if you prefer.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          category: Database["public"]["Enums"]["product_category"];
          price_minor: number;
          currency: string;
          image_url: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string;
          category: Database["public"]["Enums"]["product_category"];
          price_minor: number;
          currency?: string;
          image_url: string;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      cart_items: {
        Row: {
          user_id: string;
          product_id: string;
          quantity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          product_id: string;
          quantity: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cart_items"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          status: Database["public"]["Enums"]["order_status"];
          payment_method: Database["public"]["Enums"]["payment_method"];
          currency: string;
          subtotal_minor: number;
          total_minor: number;
          customer_email: string;
          delivery_name: string;
          delivery_phone: string;
          delivery_address: string;
          paystack_reference: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: Database["public"]["Enums"]["order_status"];
          payment_method: Database["public"]["Enums"]["payment_method"];
          currency?: string;
          subtotal_minor: number;
          total_minor: number;
          customer_email: string;
          delivery_name: string;
          delivery_phone: string;
          delivery_address: string;
          paystack_reference?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string | null;
          product_name: string;
          unit_price_minor: number;
          quantity: number;
          line_total_minor: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          unit_price_minor: number;
          quantity: number;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          id: string;
          provider: string;
          event_id: string;
          event_type: string;
          reference: string | null;
          payload: Json;
          received_at: string;
        };
        Insert: {
          id?: string;
          provider?: string;
          event_id: string;
          event_type: string;
          reference?: string | null;
          payload: Json;
          received_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payment_events"]["Insert"]>;
        Relationships: [];
      };
      email_log: {
        Row: {
          id: string;
          order_id: string;
          type: string;
          status: string;
          provider_message_id: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          type: string;
          status?: string;
          provider_message_id?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_log"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "email_log_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_order: {
        Args: {
          p_user_id: string;
          p_email: string;
          p_payment_method: Database["public"]["Enums"]["payment_method"];
          p_delivery_name: string;
          p_delivery_phone: string;
          p_delivery_address: string;
          p_paystack_reference?: string | null;
        };
        Returns: Database["public"]["Tables"]["orders"]["Row"];
      };
      mark_order_paid: {
        Args: { p_reference: string; p_amount_minor: number; p_currency: string; p_paid_at: string | null };
        Returns: { order_id: string; transitioned: boolean }[];
      };
    };
    Enums: {
      product_category: "coffee" | "pastry";
      order_status: "pending_payment" | "paid" | "failed" | "cancelled" | "cash_on_delivery";
      payment_method: "card" | "cash";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
