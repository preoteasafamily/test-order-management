import React from 'react';
import { LogOut, Menu } from 'lucide-react';

const Header = ({ currentUser, setCurrentUser, mobileMenuOpen, setMobileMenuOpen }) => (
  <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Hamburger Menu for Mobile */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
          aria-label="Toggle menu"
        >
          <Menu className="w-6 h-6 text-gray-600" />
        </button>
        
        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-800 rounded-full flex items-center justify-center">
          <span className="text-xl sm:text-2xl font-bold text-white">S</span>
        </div>
        <div>
          <h1 className="text-base sm:text-xl font-bold text-gray-800">
            Samlax
          </h1>
          <p className="text-xs sm:text-sm text-gray-600">
            {currentUser.name} (
            {currentUser.role === "admin"
              ? "Administrator"
              : currentUser.role === "birou"
                ? "Birou"
                : "Agent"}
            )
          </p>
        </div>
      </div>
      <button
        onClick={() => setCurrentUser(null)}
        className="hidden sm:flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors"
      >
        <LogOut className="w-5 h-5" />
        <span>Ieșire</span>
      </button>
      {/* Mobile Logout Button */}
      <button
        onClick={() => setCurrentUser(null)}
        className="sm:hidden p-2 hover:bg-gray-100 rounded-lg"
        aria-label="Logout"
      >
        <LogOut className="w-5 h-5 text-gray-600" />
      </button>
    </div>
  </div>
);

export default Header;
